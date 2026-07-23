"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requireCapability,
  requireLocationAccess,
  requireUser,
  type SessionUser,
} from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { jakartaDateKey } from "@/lib/format";
import { MAX_PHOTOS_PER_UPLOAD, PhotoError, savePhotoForItem } from "@/lib/photos";
import type { WeatherCode, WorkerRole } from "@/generated/prisma/enums";
import { WEATHER_ORDER, WORKER_ROLE_ORDER } from "./constants";
import {
  addIssueFromReport,
  approveReport,
  DailyReportError,
  finalizeReport,
  getOrCreateDraft,
  removeItem,
  returnReport,
  setEnrichment,
  submitReport,
  upsertItem,
} from "./service";

/**
 * Server actions laporan harian — boundary FormData + zod v4.
 * Otorisasi di SINI (requireCapability + requireLocationAccess);
 * logika bisnis + transisi di service.ts. Identitas SELALU dari sesi,
 * tidak pernah dari input client.
 */

export type DailyActionState =
  | { error?: string; success?: string; warning?: string }
  | undefined;

function errState(err: unknown): DailyActionState {
  if (err instanceof DailyReportError || err instanceof PhotoError || err instanceof ForbiddenError) {
    return { error: err.message };
  }
  throw err;
}

/** Ambil report + slug/dateKey untuk otorisasi & revalidate. */
async function loadReportContext(reportId: string) {
  const report = await db.dailyReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      locationId: true,
      reportDate: true,
      location: { select: { slug: true } },
    },
  });
  if (!report) throw new DailyReportError("Laporan tidak ditemukan");
  return { ...report, slug: report.location.slug, dateKey: jakartaDateKey(report.reportDate) };
}

function revalidateReport(slug: string, dateKey: string) {
  revalidatePath(`/lokasi/${slug}/harian/${dateKey}`);
  revalidatePath(`/lokasi/${slug}/harian`);
  revalidatePath("/hari-ini");
}

async function requireReviewOrCreate(): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, "daily_report.review") && !can(user.role, "daily_report.create")) {
    throw new ForbiddenError();
  }
  return user;
}

// ─────────────────────────────────────────────────────────────
// Item + foto (draft / perlu_koreksi)
// ─────────────────────────────────────────────────────────────

const saveItemSchema = z.object({
  locationId: z.uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  rabNodeId: z.uuid("Pilih item pekerjaan dulu"),
  volumeDone: z.coerce.number().positive("Volume harus lebih dari 0"),
  notes: z.string().trim().max(500).optional(),
  photoLat: z.coerce.number().min(-90).max(90).optional(),
  photoLng: z.coerce.number().min(-180).max(180).optional(),
  photoTakenAt: z.string().optional(),
});

export async function saveItemAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = saveItemSchema.safeParse({
      locationId: formData.get("locationId"),
      dateKey: formData.get("dateKey"),
      rabNodeId: formData.get("rabNodeId"),
      volumeDone: formData.get("volumeDone"),
      notes: formData.get("notes") ?? undefined,
      photoLat: formData.get("photoLat") || undefined,
      photoLng: formData.get("photoLng") || undefined,
      photoTakenAt: formData.get("photoTakenAt") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    await requireLocationAccess(user, d.locationId);

    const location = await db.location.findUnique({
      where: { id: d.locationId },
      select: {
        slug: true,
        name: true,
        // Nama perusahaan utk cap foto = pelaksana sesuai KONTRAK (vendor);
        // fallback ke organisasi bila kontrak belum ada.
        package: {
          select: {
            organization: { select: { name: true } },
            contract: { select: { vendor: { select: { name: true } } } },
          },
        },
      },
    });
    if (!location) return { error: "Lokasi tidak ditemukan" };
    const companyName =
      location.package?.contract?.vendor?.name ?? location.package?.organization?.name ?? null;

    const report = await getOrCreateDraft(d.locationId, d.dateKey, user.id);
    const item = await upsertItem(
      report.id,
      { rabNodeId: d.rabNodeId, volumeDone: d.volumeDone, notes: d.notes ?? null },
      user.id,
    );

    // Foto bukti (opsional, maks 6/unggah). Gagal satu foto ≠ gagal item.
    const files = formData
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, MAX_PHOTOS_PER_UPLOAD);
    const photoErrors: string[] = [];
    let takenAt: Date | null = null;
    if (d.photoTakenAt) {
      const t = new Date(d.photoTakenAt);
      if (!Number.isNaN(t.getTime())) takenAt = t;
    }
    for (const file of files) {
      try {
        await savePhotoForItem({
          reportId: report.id,
          reportItemId: item.id,
          file,
          userId: user.id,
          locationSlug: location.slug,
          dateKey: d.dateKey,
          stamp: {
            lat: d.photoLat ?? null,
            lng: d.photoLng ?? null,
            takenAt,
            locationLabel: location.name,
            companyName,
            reporterName: user.fullName,
          },
        });
      } catch (err) {
        if (err instanceof PhotoError) photoErrors.push(err.message);
        else throw err;
      }
    }

    revalidateReport(location.slug, d.dateKey);
    return {
      success: "Progres tersimpan.",
      warning: photoErrors.length ? `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}` : undefined,
    };
  } catch (err) {
    return errState(err);
  }
}

const removeItemSchema = z.object({ reportId: z.uuid(), itemId: z.uuid() });

export async function removeItemAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = removeItemSchema.safeParse({
      reportId: formData.get("reportId"),
      itemId: formData.get("itemId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    await removeItem(ctx.id, parsed.data.itemId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Item dihapus." };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Pelengkap KKP (draft / perlu_koreksi / dikirim)
// ─────────────────────────────────────────────────────────────

const enrichmentSchema = z.object({
  reportId: z.uuid(),
  weather: z.enum(WEATHER_ORDER as [WeatherCode, ...WeatherCode[]]).nullable(),
  workStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function saveEnrichmentAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireReviewOrCreate();
    const parsed = enrichmentSchema.safeParse({
      reportId: formData.get("reportId"),
      weather: formData.get("weather") || null,
      workStart: formData.get("workStart") || null,
      workEnd: formData.get("workEnd") || null,
      notes: (formData.get("notes") as string | null) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);

    const workers = WORKER_ROLE_ORDER.map((role: WorkerRole) => ({
      role,
      count: Math.max(0, Math.trunc(Number(formData.get(`worker_${role}`) ?? 0)) || 0),
    }));
    const materialNames = formData.getAll("materialName").map(String);
    const materialUnits = formData.getAll("materialUnit").map(String);
    const materialQtys = formData.getAll("materialQty").map(String);
    const materials = materialNames.map((name, i) => ({
      name,
      unit: materialUnits[i] || null,
      qty: materialQtys[i] ? Number(materialQtys[i]) : null,
    }));
    const equipmentNames = formData.getAll("equipmentName").map(String);
    const equipmentCounts = formData.getAll("equipmentCount").map(String);
    const equipment = equipmentNames.map((name, i) => ({
      name,
      count: Math.max(1, Math.trunc(Number(equipmentCounts[i] ?? 1)) || 1),
    }));

    await setEnrichment(
      ctx.id,
      {
        weather: parsed.data.weather,
        workStart: parsed.data.workStart,
        workEnd: parsed.data.workEnd,
        notes: parsed.data.notes,
        workers,
        materials,
        equipment,
      },
      user.id,
    );
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Pelengkap laporan tersimpan." };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Transisi status
// ─────────────────────────────────────────────────────────────

export async function submitReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await submitReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan terkirim — menunggu verifikasi." };
  } catch (err) {
    return errState(err);
  }
}

export async function returnReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.review");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const reason = z
      .string()
      .trim()
      .min(3, "Alasan pengembalian wajib diisi (min 3 karakter)")
      .max(1000)
      .safeParse(formData.get("reason"));
    if (!reason.success) return { error: reason.error.issues[0].message };
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await returnReport(reportId, reason.data, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan dikembalikan untuk koreksi." };
  } catch (err) {
    return errState(err);
  }
}

export async function approveReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.review");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await approveReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan disetujui." };
  } catch (err) {
    return errState(err);
  }
}

export async function finalizeReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.finalize");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await finalizeReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan difinalisasi — siap dicetak." };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Kendala (Issue) dari laporan
// ─────────────────────────────────────────────────────────────

const issueSchema = z.object({
  reportId: z.uuid(),
  title: z.string().trim().min(3, "Judul kendala wajib diisi (min 3 karakter)").max(200),
  description: z.string().trim().max(2000).optional(),
  severity: z.enum(["rendah", "sedang", "tinggi", "kritis"]),
});

export async function addIssueAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireUser();
    if (!can(user.role, "issue.manage") && !can(user.role, "daily_report.create")) {
      throw new ForbiddenError();
    }
    const parsed = issueSchema.safeParse({
      reportId: formData.get("reportId"),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
      severity: formData.get("severity"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    await addIssueFromReport(
      ctx.id,
      {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        severity: parsed.data.severity,
      },
      user.id,
    );
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Kendala tercatat." };
  } catch (err) {
    return errState(err);
  }
}
