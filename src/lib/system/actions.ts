"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { r2SelfTest, type R2SelfTestStep } from "@/lib/r2";
import { sharpSelfTest } from "@/lib/photos";
import { getBranding, setBranding } from "@/lib/branding";
import { getPhotoStampConfig, setPhotoStampConfig, type PhotoStampConfig } from "@/lib/photo-stamp/config";

export type R2TestState =
  | { ok: boolean; steps: R2SelfTestStep[]; stampSampleDataUri?: string }
  | undefined;

export async function runR2Test(): Promise<R2TestState> {
  const actor = await requireCapability("system.manage");
  // Uji R2 (round-trip) + sharp (pemrosesan gambar) sekaligus: keduanya syarat
  // foto lapangan tersimpan. sharp diuji terpisah supaya jelas bila justru
  // pemrosesan gambar yang gagal (bukan R2) — penyebab umum "foto tak muncul".
  const [r2, sharp] = await Promise.all([r2SelfTest(), sharpSelfTest()]);
  const steps: R2SelfTestStep[] = [
    ...r2.steps,
    { step: "SHARP", ok: sharp.ok, detail: sharp.detail },
  ];
  const result = { ok: r2.ok && sharp.ok, steps, stampSampleDataUri: sharp.sampleDataUri };
  await audit(actor.id, "system.r2_test", "system", null, { ok: result.ok, sharp: sharp.ok });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Branding (nama app + tagline + konteks proyek) — bisa diubah admin
// ─────────────────────────────────────────────────────────────

export type BrandingState =
  | {
      error?: string;
      success?: string;
      values?: { appName: string; tagline: string; projectContext: string; ownerName: string; ownerSubtitle: string };
    }
  | undefined;

const brandingSchema = z.object({
  appName: z.string().trim().max(60, "Nama app maksimal 60 karakter"),
  tagline: z.string().trim().max(160, "Tagline maksimal 160 karakter"),
  projectContext: z.string().trim().max(160, "Konteks proyek maksimal 160 karakter"),
  ownerName: z.string().trim().max(120, "Nama pemilik pekerjaan maksimal 120 karakter"),
  ownerSubtitle: z.string().trim().max(160, "Keterangan pemilik pekerjaan maksimal 160 karakter"),
});

/** Batas & format logo pemilik pekerjaan — sama dengan logo perusahaan. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function saveBranding(_prev: BrandingState, formData: FormData): Promise<BrandingState> {
  const actor = await requireCapability("system.manage");
  const parsed = brandingSchema.safeParse({
    appName: formData.get("appName") ?? "",
    tagline: formData.get("tagline") ?? "",
    projectContext: formData.get("projectContext") ?? "",
    ownerName: formData.get("ownerName") ?? "",
    ownerSubtitle: formData.get("ownerSubtitle") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Logo pemilik pekerjaan (opsional). Diperkecil & dinormalisasi ke WebP
  // supaya kop blanko ringan dan formatnya seragam — pola sama dengan logo
  // perusahaan di master vendor.
  let ownerLogoKey: string | undefined;
  const file = formData.get("ownerLogo");
  if (file instanceof File && file.size > 0) {
    const { isR2Configured, r2Put } = await import("@/lib/r2");
    if (!isR2Configured()) return { error: "Penyimpanan berkas (R2) belum dikonfigurasi." };
    if (file.size > LOGO_MAX_BYTES) return { error: "Logo terlalu besar (maks 2 MB)." };
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return { error: "Format logo harus PNG/JPG/WebP." };
    const sharp = (await import("sharp")).default;
    const buf = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    ownerLogoKey = `branding/owner-logo-${Date.now()}.webp`;
    await r2Put(ownerLogoKey, buf, "image/webp");
  }

  // Kosong → pakai default (tetap disimpan sbg string kosong → getBranding fallback).
  await setBranding({ ...parsed.data, ...(ownerLogoKey ? { ownerLogoKey } : {}) });
  await audit(actor.id, "system.branding_update", "system", null, parsed.data);
  const values = await getBranding();
  // Refresh shell + login supaya perubahan langsung tampak.
  revalidatePath("/", "layout");
  return { success: "Branding tersimpan.", values };
}

export type ResetState = { error?: string; success?: string } | undefined;

/**
 * Reset data operasional (laporan, foto, transaksi) — HANYA dev/test, guard ganda:
 * capability system.manage + APP_ENV bukan production + konfirmasi ketik.
 */
export async function resetOperationalData(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const actor = await requireCapability("system.manage");
  if (env.APP_ENV === "production") return { error: "Reset dilarang di production." };
  if (formData.get("confirm") !== "KOSONGKAN") return { error: 'Ketik "KOSONGKAN" untuk konfirmasi.' };

  await db.$transaction([
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_status_history" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "photos" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_items" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_workers" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_materials" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_equipment" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_reports" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "recovery_updates" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "recovery_actions" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "issues" CASCADE'),
  ]);
  await audit(actor.id, "system.reset_operational", "system", null);
  revalidatePath("/");
  return { success: "Data operasional (laporan, foto, kendala) dikosongkan. Master & RAB tetap." };
}

// ── Cap foto (Photo Stamp) ────────────────────────────────────────────────────
export type PhotoStampState = { error?: string; success?: string; values?: PhotoStampConfig } | undefined;

const photoStampSchema = z.object({
  accentColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/, "Warna HEX tidak valid (contoh: #FF8A00)"),
  overlayStrength: z.enum(["auto", "light", "standard", "strong"]),
  size: z.enum(["compact", "standard", "large"]),
  showCoordinates: z.boolean(),
  showReporter: z.boolean(),
  showPhotoId: z.boolean(),
});

export async function savePhotoStampConfigAction(
  _prev: PhotoStampState,
  formData: FormData,
): Promise<PhotoStampState> {
  const actor = await requireCapability("system.manage");
  const parsed = photoStampSchema.safeParse({
    accentColor: formData.get("accentColor") ?? "",
    overlayStrength: formData.get("overlayStrength") ?? "auto",
    size: formData.get("size") ?? "standard",
    showCoordinates: formData.get("showCoordinates") === "on",
    showReporter: formData.get("showReporter") === "on",
    showPhotoId: formData.get("showPhotoId") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await setPhotoStampConfig(parsed.data);
  await audit(actor.id, "system.photo_stamp_update", "system", null, parsed.data);
  return { success: "Pengaturan cap foto tersimpan — berlaku pada foto berikutnya.", values: await getPhotoStampConfig() };
}

// ─── Master data jenis kegiatan lapangan ──────────────────────────────
// Kelola pilihan "Jenis kegiatan" (tabel FieldActivityKind) tanpa developer.
// Key stabil (immutable) supaya data lama tetap tertaut; label & aktif bisa diubah.

export type ActivityKindState = { error?: string; success?: string } | undefined;

const activityKindSchema = z.object({
  key: z.string().trim().optional().default(""),
  label: z.string().trim().min(2, "Nama minimal 2 karakter").max(60, "Nama maksimal 60 karakter"),
  isActive: z.boolean().default(true),
});

function slugifyKind(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "jenis"
  );
}

export async function saveActivityKindAction(_prev: ActivityKindState, formData: FormData): Promise<ActivityKindState> {
  const actor = await requireCapability("system.manage");
  const parsed = activityKindSchema.safeParse({
    key: formData.get("key") ?? "",
    label: formData.get("label") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.key) {
    const existing = await db.fieldActivityKind.findUnique({ where: { key: d.key } });
    if (!existing) return { error: "Jenis kegiatan tidak ditemukan." };
    await db.fieldActivityKind.update({ where: { key: d.key }, data: { label: d.label, isActive: d.isActive } });
    await audit(actor.id, "system.activity_kind_update", "field_activity_kind", existing.id, {
      key: d.key,
      label: d.label,
      isActive: d.isActive,
    });
    revalidatePath("/sistem");
    return { success: `Jenis "${d.label}" diperbarui.` };
  }

  // Tambah baru: key = slug label, dijamin unik.
  const taken = new Set((await db.fieldActivityKind.findMany({ select: { key: true } })).map((k) => k.key));
  let key = slugifyKind(d.label);
  if (taken.has(key)) {
    let i = 2;
    while (taken.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const maxOrder = (await db.fieldActivityKind.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  const created = await db.fieldActivityKind.create({
    data: { key, label: d.label, isActive: true, sortOrder: maxOrder + 10 },
  });
  await audit(actor.id, "system.activity_kind_create", "field_activity_kind", created.id, { key, label: d.label });
  revalidatePath("/sistem");
  return { success: `Jenis "${d.label}" ditambahkan.` };
}

/* ── Bangun ulang snapshot laporan harian final ─────────────────────────── */

export type RebuildSnapshotState = { error?: string; success?: string } | undefined;

/**
 * Hitung ulang `finalSnapshot` laporan harian yang sudah final dari data
 * laporan yang SAMA — status, volume, dan input tidak disentuh sama sekali.
 *
 * Perlu karena snapshot dibekukan saat finalisasi: perbaikan rumus (mis.
 * DECISIONS 147, kumulatif tidak dibatasi tanggal) tidak otomatis merambat ke
 * laporan yang terlanjur final. Idempoten & aman diulang. DECISIONS 148.
 */
export async function rebuildFinalSnapshots(
  _prev: RebuildSnapshotState,
  formData: FormData,
): Promise<RebuildSnapshotState> {
  try {
    const actor = await requireCapability("system.manage");
    const scope = z
      .object({ locationId: z.string().trim() })
      .safeParse({ locationId: formData.get("locationId") ?? "" });
    const locationId = scope.success && scope.data.locationId ? scope.data.locationId : null;

    const reports = await db.dailyReport.findMany({
      where: {
        status: "final",
        location: locationId ? { id: locationId, package: { orgId: actor.orgId } } : { package: { orgId: actor.orgId } },
      },
      orderBy: [{ locationId: "asc" }, { reportDate: "asc" }],
      select: { id: true },
    });
    if (reports.length === 0) return { error: "Tidak ada laporan harian berstatus final pada cakupan ini." };

    const { buildFinalSnapshot } = await import("@/lib/daily-report/service");
    let ok = 0;
    let gagal = 0;
    // Berurutan, bukan paralel: menghitung kumulatif per laporan cukup berat
    // dan koreksi ini tidak perlu cepat — yang penting tidak membebani DB.
    for (const r of reports) {
      try {
        const snapshot = await buildFinalSnapshot(r.id);
        await db.dailyReport.update({
          where: { id: r.id },
          data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        ok++;
      } catch {
        gagal++;
      }
    }

    await audit(actor.id, "daily_report.snapshot_rebuild", "location", locationId, {
      total: reports.length,
      ok,
      gagal,
    });
    revalidatePath("/", "layout");
    return {
      success:
        `${ok} laporan final dibangun ulang${gagal > 0 ? `, ${gagal} gagal` : ""}. ` +
        "Status & data input tidak berubah — hanya angka pada cetakan yang dihitung ulang.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
