"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { r2GetBuffer } from "@/lib/r2";
import { formatTanggal } from "@/lib/format";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { buildPeriodReportXlsx } from "@/lib/export/xlsx";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { buildDailyReportXlsx } from "@/lib/export/daily-xlsx";
import {
  WahaError,
  getSessionStatus,
  listGroups,
  normalizeGroupChatId,
  resolveGroupByInvite,
  sendFile,
  sendImage,
  sendText,
  toFilePayload,
  type WahaGroup,
} from "@/lib/waha/client";
import { WahaConfigError, setWahaConfig } from "@/lib/waha/config";

export type WaActionState = { error?: string; success?: string; warning?: string } | undefined;

function fail(err: unknown): WaActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof WahaError || err instanceof WahaConfigError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/* ------------------------------------------------------------------ */
/* Konfigurasi WAHA (setting aplikasi, khusus super_admin)             */
/* ------------------------------------------------------------------ */

const saveConfigSchema = z.object({
  baseUrl: z.string().trim().max(300),
  apiKey: z.string().max(300),
  session: z.string().trim().max(100),
});

/**
 * Simpan konfigurasi WAHA (URL/API key/sesi) sebagai setting aplikasi.
 * apiKey kosong = pertahankan yang lama; "-" = hapus.
 */
export async function saveWahaConfigAction(
  _prev: WaActionState,
  formData: FormData,
): Promise<WaActionState> {
  const parsed = saveConfigSchema.safeParse({
    baseUrl: formData.get("baseUrl") ?? "",
    apiKey: formData.get("apiKey") ?? "",
    session: formData.get("session") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const user = await requireCapability("system.manage");
    // apiKey: undefined (jangan ubah) bila kosong; "" (hapus) bila "-".
    const apiKey = d.apiKey.trim() === "" ? undefined : d.apiKey.trim() === "-" ? "" : d.apiKey;
    await setWahaConfig({ baseUrl: d.baseUrl, apiKey, session: d.session });
    await audit(user.id, "system.waha_config", "app_setting", null, {});
    revalidatePath("/sistem");
    return { success: "Konfigurasi WhatsApp disimpan." };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Konfigurasi grup per paket                                          */
/* ------------------------------------------------------------------ */

const setGroupSchema = z.object({
  packageId: z.uuid(),
  waGroupId: z.string().trim().max(120).optional(),
  waGroupName: z.string().trim().max(200).optional(),
});

/** Set / hapus grup WhatsApp tujuan sebuah paket. Kosongkan untuk melepas. */
export async function setPackageWaGroupAction(
  _prev: WaActionState,
  formData: FormData,
): Promise<WaActionState> {
  const parsed = setGroupSchema.safeParse({
    packageId: formData.get("packageId"),
    waGroupId: formData.get("waGroupId") || undefined,
    waGroupName: formData.get("waGroupName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("wa.configure");
    const pkg = await db.package.findUnique({ where: { id: d.packageId }, select: { id: true } });
    if (!pkg) return { error: "Paket tidak ditemukan." };

    let groupId: string | null = null;
    if (d.waGroupId) {
      try {
        groupId = normalizeGroupChatId(d.waGroupId);
      } catch (err) {
        return fail(err);
      }
    }

    await db.package.update({
      where: { id: pkg.id },
      data: { waGroupId: groupId, waGroupName: groupId ? d.waGroupName ?? null : null },
    });
    await audit(user.id, "package.wa_group_set", "package", pkg.id, { waGroupId: groupId });
    revalidatePath(`/paket/${pkg.id}`);
    return { success: groupId ? "Grup WhatsApp paket disimpan." : "Grup WhatsApp paket dilepas." };
  } catch (err) {
    return fail(err);
  }
}

/** Ambil daftar grup dari WAHA (untuk dropdown pemilihan). */
export async function listWaGroupsAction(): Promise<
  { ok: true; groups: WahaGroup[] } | { ok: false; error: string }
> {
  try {
    await requireCapability("wa.configure");
    const status = await getSessionStatus();
    if (status.status !== "WORKING") {
      return {
        ok: false,
        error: `Sesi WhatsApp belum siap (status: ${status.status}). Scan QR di server WAHA dulu, lalu coba lagi.`,
      };
    }
    const groups = await listGroups();
    return { ok: true, groups };
  } catch (err) {
    const s = fail(err);
    return { ok: false, error: s?.error ?? "Gagal memuat grup." };
  }
}

/** Ambil ID grup dari link undangan (chat.whatsapp.com/…). */
export async function resolveWaInviteAction(
  link: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    await requireCapability("wa.configure");
    if (!link || !link.trim()) return { ok: false, error: "Tempel link undangan grup dulu." };
    const g = await resolveGroupByInvite(link);
    return { ok: true, id: g.id, name: g.name };
  } catch (err) {
    const s = fail(err);
    return { ok: false, error: s?.error ?? "Gagal mengambil ID grup." };
  }
}

/** Status koneksi + sesi WAHA (untuk halaman Sistem / tombol tes). */
export async function wahaStatusAction(): Promise<
  { ok: true; status: string; me: string | null } | { ok: false; error: string }
> {
  try {
    await requireCapability("wa.configure");
    const s = await getSessionStatus();
    return { ok: true, status: s.status, me: s.me?.pushName ?? s.me?.id ?? null };
  } catch (err) {
    const st = fail(err);
    return { ok: false, error: st?.error ?? "Gagal cek status." };
  }
}

/* ------------------------------------------------------------------ */
/* Kirim kegiatan lapangan ke grup WA (1 klik)                         */
/* ------------------------------------------------------------------ */

/** Rangkai teks ringkas kegiatan untuk pesan WA. */
function buildActivityMessage(a: {
  typeLabel: string;
  activityDate: Date;
  title: string;
  notes: string | null;
  participants: string | null;
  kendala: string | null;
  solusi: string | null;
  locationName: string;
}): string {
  const lines: string[] = [];
  lines.push(`*${a.title}*`);
  lines.push(`📋 ${a.typeLabel} · 📅 ${formatTanggal(a.activityDate)}`);
  lines.push(`📍 ${a.locationName}`);
  if (a.participants) lines.push(`👥 Hadir: ${a.participants}`);
  if (a.notes) lines.push(`\n${a.notes}`);
  if (a.kendala) lines.push(`\n⚠️ *Kendala:* ${a.kendala}`);
  if (a.solusi) lines.push(`✅ *Solusi/tindak lanjut:* ${a.solusi}`);
  return lines.join("\n");
}

/**
 * Kirim satu kegiatan lapangan (teks + semua foto + semua dokumen) ke grup WA
 * paketnya. Sekali klik. Menandai waSentAt agar terlihat "sudah dikirim".
 */
export async function sendActivityToWaAction(
  _prev: WaActionState,
  formData: FormData,
): Promise<WaActionState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };

  try {
    const user = await requireCapability("field_activity.manage");
    const activity = await db.fieldActivity.findUnique({
      where: { id: idParse.data },
      select: {
        id: true,
        type: true,
        activityDate: true,
        title: true,
        notes: true,
        participants: true,
        kendala: true,
        solusi: true,
        locationId: true,
        location: {
          select: {
            name: true,
            slug: true,
            package: { select: { name: true, waGroupId: true, waGroupName: true } },
          },
        },
        photos: { orderBy: { createdAt: "asc" }, select: { r2Key: true } },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { r2Key: true, fileName: true, mimeType: true },
        },
      },
    });
    if (!activity) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, activity.locationId);

    const groupId = activity.location.package?.waGroupId;
    if (!groupId) {
      return {
        error:
          "Paket ini belum punya grup WhatsApp. Atur dulu di halaman Paket → Grup WhatsApp, baru kirim.",
      };
    }
    const chatId = normalizeGroupChatId(groupId);

    // 1) Teks ringkas.
    const message = buildActivityMessage({
      typeLabel: (await getActivityKindLabelMap()).get(activity.type) ?? activity.type,
      activityDate: activity.activityDate,
      title: activity.title,
      notes: activity.notes,
      participants: activity.participants,
      kendala: activity.kendala,
      solusi: activity.solusi,
      locationName: activity.location.name,
    });
    await sendText(chatId, message);

    // 2) Foto (sebagai gambar). Best-effort — kumpulkan kegagalan.
    const errors: string[] = [];
    let photoI = 0;
    for (const p of activity.photos) {
      photoI++;
      try {
        const buf = await r2GetBuffer(p.r2Key);
        await sendImage(chatId, toFilePayload(buf, "image/jpeg", `foto-${photoI}.jpg`));
      } catch (err) {
        errors.push(`foto-${photoI}: ${err instanceof Error ? err.message : "gagal"}`);
      }
    }

    // 3) Dokumen (sebagai file).
    for (const att of activity.attachments) {
      try {
        const buf = await r2GetBuffer(att.r2Key);
        await sendFile(chatId, toFilePayload(buf, att.mimeType || "application/octet-stream", att.fileName));
      } catch (err) {
        errors.push(`${att.fileName}: ${err instanceof Error ? err.message : "gagal"}`);
      }
    }

    await db.fieldActivity.update({
      where: { id: activity.id },
      data: { waSentAt: new Date(), waSentById: user.id },
    });
    await audit(user.id, "field_activity.wa_send", "field_activity", activity.id, {
      locationId: activity.locationId,
      photos: activity.photos.length,
      attachments: activity.attachments.length,
    });
    revalidatePath(`/lokasi/${activity.location.slug}/kegiatan`);

    const sentCount = 1 + (activity.photos.length - errors.filter((e) => e.startsWith("foto-")).length) + activity.attachments.length;
    if (errors.length) {
      return {
        success: `Terkirim ke grup WhatsApp (${sentCount} item).`,
        warning: `Sebagian lampiran gagal: ${errors.join("; ")}`,
      };
    }
    return { success: "Kegiatan terkirim ke grup WhatsApp (teks, foto, dokumen)." };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Kirim laporan (harian / mingguan) sebagai Excel ke grup WA          */
/* ------------------------------------------------------------------ */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Grup WA + nama paket dari sebuah lokasi. */
async function groupForLocation(locationId: string) {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { name: true, slug: true, package: { select: { name: true, waGroupId: true } } },
  });
  return loc;
}

/** Kirim laporan periodik (mingguan/bulanan) sebagai Excel ke grup WA paket. */
export async function sendPeriodReportToWaAction(
  _prev: WaActionState,
  formData: FormData,
): Promise<WaActionState> {
  const schema = z.object({
    locationId: z.uuid(),
    kind: z.enum(["mingguan", "bulanan"]),
    n: z.coerce.number().int().min(1).max(520),
  });
  const parsed = schema.safeParse({
    locationId: formData.get("locationId"),
    kind: formData.get("kind"),
    n: formData.get("n"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, kind, n } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    await requireLocationAccess(user, locationId);
    const loc = await groupForLocation(locationId);
    if (!loc) return { error: "Lokasi tidak ditemukan." };
    if (!loc.package?.waGroupId) {
      return { error: "Paket ini belum punya grup WhatsApp. Minta admin mengaturnya di halaman Paket." };
    }
    const chatId = normalizeGroupChatId(loc.package.waGroupId);

    const report = await getPeriodReport(locationId, kind as PeriodKind, n);
    if (!report) return { error: "Laporan untuk periode ini tidak tersedia." };
    const buf = await buildPeriodReportXlsx(report);

    const periodeLabel = kind === "mingguan" ? `Minggu ke-${n}` : `Bulan ke-${n}`;
    const caption = [
      `*Laporan ${kind === "mingguan" ? "Mingguan" : "Bulanan"} — ${periodeLabel}*`,
      `📍 ${loc.name}`,
      report.header?.periodeStart && report.header?.periodeEnd
        ? `📅 ${formatTanggal(report.header.periodeStart)} s/d ${formatTanggal(report.header.periodeEnd)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    await sendText(chatId, caption);
    const fileName = `laporan-${kind}-${loc.slug}-${n}.xlsx`;
    await sendFile(chatId, toFilePayload(buf, XLSX_MIME, fileName), fileName);

    await audit(user.id, "report.wa_send", "location", locationId, { kind, n });
    return { success: `Laporan ${kind} (${periodeLabel}) terkirim ke grup WhatsApp.` };
  } catch (err) {
    return fail(err);
  }
}

/** Kirim laporan harian (Excel) ke grup WA paket + tandai waSentAt. */
export async function sendDailyReportToWaAction(
  _prev: WaActionState,
  formData: FormData,
): Promise<WaActionState> {
  const schema = z.object({
    slug: z.string().trim().min(1),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  });
  const parsed = schema.safeParse({ slug: formData.get("slug"), dateKey: formData.get("dateKey") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, dateKey } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    const locBasic = await db.location.findUnique({ where: { slug }, select: { id: true } });
    if (!locBasic) return { error: "Lokasi tidak ditemukan." };
    await requireLocationAccess(user, locBasic.id);
    const loc = await groupForLocation(locBasic.id);
    if (!loc?.package?.waGroupId) {
      return { error: "Paket ini belum punya grup WhatsApp. Minta admin mengaturnya di halaman Paket." };
    }
    const chatId = normalizeGroupChatId(loc.package.waGroupId);

    const data = await getKkpDailyData(slug, dateKey);
    if (!data) return { error: "Laporan harian tidak ditemukan." };
    const buf = await buildDailyReportXlsx(data);

    const caption = [
      `*Laporan Harian*`,
      `📍 ${data.locationName}`,
      `📅 ${data.hari}, ${data.tanggalFull}`,
      `👷 ${data.totalWorkers} pekerja${data.activeWeather ? ` · ☁️ ${data.activeWeather}` : ""}`,
    ].join("\n");

    await sendText(chatId, caption);
    const fileName = `laporan-harian-${slug}-${dateKey}.xlsx`;
    await sendFile(chatId, toFilePayload(buf, XLSX_MIME, fileName), fileName);

    // Tandai "sudah dikirim" bila laporan final tersimpan (row nyata).
    await db.dailyReport
      .update({
        where: { locationId_reportDate: { locationId: locBasic.id, reportDate: new Date(`${dateKey}T00:00:00.000Z`) } },
        data: { waSentAt: new Date(), waSentById: user.id },
      })
      .catch(() => {});
    await audit(user.id, "report.wa_send", "daily_report", null, { locationId: locBasic.id, dateKey });
    revalidatePath(`/lokasi/${slug}/laporan-lokasi`);
    return { success: "Laporan harian terkirim ke grup WhatsApp." };
  } catch (err) {
    return fail(err);
  }
}
