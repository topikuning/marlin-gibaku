"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createInspection, finalizeInspection, InspectionError, updateInspection } from "./service";

export type InspectionActionState = { error?: string; success?: string; inspectionId?: string } | undefined;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function fail(err: unknown): InspectionActionState {
  if (err instanceof ForbiddenError || err instanceof InspectionError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

function revalidateInspeksi(id?: string): void {
  revalidatePath("/verifikasi");
  if (id) revalidatePath(`/verifikasi/inspeksi/${id}`);
}

const createSchema = z.object({
  locationId: z.uuid(),
  inspectionDateKey: z.string().regex(DATE_KEY, "Tanggal inspeksi tidak sah"),
  title: z.string().trim().min(3, "Judul inspeksi minimal 3 karakter").max(200),
  notes: z.string().trim().max(8000).optional(),
  recommendation: z.string().trim().max(4000).optional(),
  gpsLat: z.coerce.number().min(-90).max(90).optional(),
  gpsLng: z.coerce.number().min(-180).max(180).optional(),
});

export async function createInspectionAction(
  _prev: InspectionActionState,
  formData: FormData,
): Promise<InspectionActionState> {
  const parsed = createSchema.safeParse({
    locationId: formData.get("locationId"),
    inspectionDateKey: formData.get("inspectionDateKey"),
    title: formData.get("title"),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    recommendation: String(formData.get("recommendation") ?? "").trim() || undefined,
    gpsLat: String(formData.get("gpsLat") ?? "").trim() || undefined,
    gpsLng: String(formData.get("gpsLng") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await requireCapability("inspection.manage");
    await requireLocationAccess(user, parsed.data.locationId);
    const row = await createInspection(parsed.data, user.id);
    revalidateInspeksi(row.id);
    return { success: "Inspeksi dicatat sebagai draft.", inspectionId: row.id };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  inspectionId: z.uuid(),
  inspectionDateKey: z.string().regex(DATE_KEY).optional(),
  title: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(8000).optional(),
  recommendation: z.string().trim().max(4000).optional(),
});

async function guardInspeksi(inspectionId: string) {
  const user = await requireCapability("inspection.manage");
  const row = await db.inspection.findUnique({ where: { id: inspectionId }, select: { locationId: true } });
  if (!row) throw new InspectionError("Inspeksi tidak ditemukan.");
  await requireLocationAccess(user, row.locationId);
  return user;
}

export async function updateInspectionAction(
  _prev: InspectionActionState,
  formData: FormData,
): Promise<InspectionActionState> {
  const parsed = updateSchema.safeParse({
    inspectionId: formData.get("inspectionId"),
    inspectionDateKey: String(formData.get("inspectionDateKey") ?? "").trim() || undefined,
    title: formData.get("title"),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    recommendation: String(formData.get("recommendation") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardInspeksi(parsed.data.inspectionId);
    await updateInspection(parsed.data.inspectionId, parsed.data, user.id);
    revalidateInspeksi(parsed.data.inspectionId);
    return { success: "Inspeksi diperbarui." };
  } catch (err) {
    return fail(err);
  }
}

const finalizeSchema = z.object({ inspectionId: z.uuid() });

export async function finalizeInspectionAction(
  _prev: InspectionActionState,
  formData: FormData,
): Promise<InspectionActionState> {
  const parsed = finalizeSchema.safeParse({ inspectionId: formData.get("inspectionId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await guardInspeksi(parsed.data.inspectionId);
    await finalizeInspection(parsed.data.inspectionId, user.id);
    revalidateInspeksi(parsed.data.inspectionId);
    return { success: "Inspeksi difinalkan." };
  } catch (err) {
    return fail(err);
  }
}
