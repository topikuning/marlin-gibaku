"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canApprove } from "@/lib/report";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { parseLogDate, WORKER_ROLE_ORDER } from "@/lib/daily-log";
import type { WeatherCode, WorkerRole } from "@prisma/client";

type SaveState = { ok?: string; error?: string };

const WEATHERS: WeatherCode[] = [
  "cerah",
  "berawan",
  "hujan_ringan",
  "hujan_deras",
  "angin_kencang",
  "banjir",
];

export async function saveDailyLog(
  _prev: SaveState | undefined,
  formData: FormData
): Promise<SaveState> {
  const session = await auth();
  if (!session?.user) return { error: "Sesi berakhir, silakan masuk lagi." };
  const { id: userId, role } = session.user;
  if (!canApprove(role))
    return { error: "Hanya Site Manager / admin yang boleh melengkapi laporan KKP." };

  const slug = String(formData.get("slug") ?? "");
  const dateStr = String(formData.get("logDate") ?? "");
  const logDate = parseLogDate(dateStr);
  if (!logDate) return { error: "Tanggal tidak valid." };

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!location) return { error: "Lokasi tidak ditemukan." };
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id)))
    return { error: "Tidak ada akses ke lokasi ini." };

  const weatherRaw = String(formData.get("weather") ?? "");
  const weather = WEATHERS.includes(weatherRaw as WeatherCode)
    ? (weatherRaw as WeatherCode)
    : null;
  const workStart = String(formData.get("workStart") ?? "").trim() || null;
  const workEnd = String(formData.get("workEnd") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Tenaga per keahlian: input worker_<role>
  const workers: { role: WorkerRole; count: number }[] = [];
  for (const r of WORKER_ROLE_ORDER) {
    const n = Number(formData.get(`worker_${r}`) ?? 0);
    if (Number.isFinite(n) && n > 0) workers.push({ role: r, count: Math.floor(n) });
  }

  // Material & peralatan: JSON dari client
  let materials: { name: string; unit: string | null; qty: number | null }[] = [];
  let equipment: { name: string; count: number }[] = [];
  try {
    const m = JSON.parse(String(formData.get("materials") ?? "[]"));
    if (Array.isArray(m))
      materials = m
        .filter((x) => x && String(x.name ?? "").trim())
        .map((x) => ({
          name: String(x.name).trim().slice(0, 200),
          unit: String(x.unit ?? "").trim().slice(0, 30) || null,
          qty: x.qty != null && x.qty !== "" && Number.isFinite(Number(x.qty)) ? Number(x.qty) : null,
        }));
  } catch {}
  try {
    const e = JSON.parse(String(formData.get("equipment") ?? "[]"));
    if (Array.isArray(e))
      equipment = e
        .filter((x) => x && String(x.name ?? "").trim())
        .map((x) => ({
          name: String(x.name).trim().slice(0, 200),
          count: Number.isFinite(Number(x.count)) && Number(x.count) > 0 ? Math.floor(Number(x.count)) : 1,
        }));
  } catch {}

  await db.$transaction(async (tx) => {
    const log = await tx.dailyLog.upsert({
      where: { locationId_logDate: { locationId: location.id, logDate } },
      create: {
        locationId: location.id,
        logDate,
        weather,
        workStart,
        workEnd,
        notes,
        createdByUserId: userId,
      },
      update: { weather, workStart, workEnd, notes },
    });
    await tx.dailyLogWorker.deleteMany({ where: { logId: log.id } });
    await tx.dailyLogMaterial.deleteMany({ where: { logId: log.id } });
    await tx.dailyLogEquipment.deleteMany({ where: { logId: log.id } });
    if (workers.length)
      await tx.dailyLogWorker.createMany({
        data: workers.map((w) => ({ logId: log.id, role: w.role, count: w.count })),
      });
    if (materials.length)
      await tx.dailyLogMaterial.createMany({
        data: materials.map((m) => ({ logId: log.id, name: m.name, unit: m.unit, qtyReceived: m.qty })),
      });
    if (equipment.length)
      await tx.dailyLogEquipment.createMany({
        data: equipment.map((e) => ({ logId: log.id, name: e.name, count: e.count })),
      });
  });

  revalidatePath(`/lokasi/${slug}/harian/${dateStr}`);
  return { ok: "Laporan harian KKP tersimpan." };
}
