"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { createAutoPlan, updatePlanMilestones } from "@/lib/scurve-plan";

type ActionState = { ok?: string; error?: string };

async function guard(locationId: string) {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return null;
  // Pastikan plan/lokasi valid akan dicek di pemanggil.
  void locationId;
  return session.user;
}

/** Simpan edit target mingguan (jadikan plan 'manual'). */
export async function savePlan(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const planId = String(formData.get("planId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const user = await guard(planId);
  if (!user) return { error: "Tidak berwenang." };

  const plan = await db.scurvePlan.findUnique({
    where: { id: planId },
    include: { milestones: { select: { weekNumber: true } } },
  });
  if (!plan) return { error: "Plan tidak ditemukan." };
  if (plan.status !== "active") return { error: "Hanya plan aktif yang bisa diedit." };

  const rows: { weekNumber: number; pct: number }[] = [];
  for (const m of plan.milestones) {
    const raw = formData.get(`w_${m.weekNumber}`);
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { error: `Nilai minggu ${m.weekNumber} tidak valid (0–100).` };
    }
    rows.push({ weekNumber: m.weekNumber, pct: Math.round(pct * 1000) / 1000 });
  }
  rows.sort((a, b) => a.weekNumber - b.weekNumber);
  // Kurva kumulatif tidak boleh turun.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].pct < rows[i - 1].pct) {
      return { error: `Kurva kumulatif turun di minggu ${rows[i].weekNumber} — target tidak boleh lebih kecil dari minggu sebelumnya.` };
    }
  }

  await updatePlanMilestones(planId, rows);
  revalidatePath(`/lokasi/${slug}/kurva-s`);
  revalidatePath(`/lokasi/${slug}`);
  revalidatePath("/beranda");
  return { ok: "Kurva-S tersimpan." };
}

/** Generate ulang dari rumus (RAB revisi aktif + durasi kontrak). */
export async function regeneratePlan(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const user = await guard(locationId);
  if (!user) return { error: "Tidak berwenang." };

  try {
    await createAutoPlan(locationId, { source: "auto", createdByUserId: user.id, note: "Generate ulang dari rumus" });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal generate ulang." };
  }
  revalidatePath(`/lokasi/${slug}/kurva-s`);
  revalidatePath(`/lokasi/${slug}`);
  revalidatePath("/beranda");
  return { ok: "Kurva-S di-generate ulang dari rumus." };
}
