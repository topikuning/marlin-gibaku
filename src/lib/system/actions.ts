"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
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
  | { error?: string; success?: string; values?: { appName: string; tagline: string; projectContext: string } }
  | undefined;

const brandingSchema = z.object({
  appName: z.string().trim().max(60, "Nama app maksimal 60 karakter"),
  tagline: z.string().trim().max(160, "Tagline maksimal 160 karakter"),
  projectContext: z.string().trim().max(160, "Konteks proyek maksimal 160 karakter"),
});

export async function saveBranding(_prev: BrandingState, formData: FormData): Promise<BrandingState> {
  const actor = await requireCapability("system.manage");
  const parsed = brandingSchema.safeParse({
    appName: formData.get("appName") ?? "",
    tagline: formData.get("tagline") ?? "",
    projectContext: formData.get("projectContext") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Kosong → pakai default (tetap disimpan sbg string kosong → getBranding fallback).
  await setBranding(parsed.data);
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
