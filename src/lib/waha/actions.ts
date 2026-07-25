"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { r2GetBuffer } from "@/lib/r2";
import { formatTanggal } from "@/lib/format";
import { FIELD_ACTIVITY_TYPE_LABEL } from "@/lib/field-activity/labels";
import {
  WahaError,
  getSessionStatus,
  listGroups,
  normalizeGroupChatId,
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
  type: keyof typeof FIELD_ACTIVITY_TYPE_LABEL;
  activityDate: Date;
  title: string;
  notes: string | null;
  participants: string | null;
  kendala: string | null;
  solusi: string | null;
  locationName: string;
  packageName: string;
}): string {
  const lines: string[] = [];
  lines.push(`*${a.title}*`);
  lines.push(`📋 ${FIELD_ACTIVITY_TYPE_LABEL[a.type]} · 📅 ${formatTanggal(a.activityDate)}`);
  lines.push(`📍 ${a.locationName} — ${a.packageName}`);
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
      type: activity.type,
      activityDate: activity.activityDate,
      title: activity.title,
      notes: activity.notes,
      participants: activity.participants,
      kendala: activity.kendala,
      solusi: activity.solusi,
      locationName: activity.location.name,
      packageName: activity.location.package?.name ?? "-",
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
