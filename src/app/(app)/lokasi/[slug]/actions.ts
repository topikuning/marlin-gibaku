"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { canTransitionLocation, LOCATION_STATUS_LABEL } from "@/lib/lifecycle";
import { coordinateForDb, parseCoordinatePair } from "@/lib/geo";
import type { LocationStatus } from "@/generated/prisma/enums";

export type StatusActionState = { error?: string; success?: string } | undefined;

const LOCATION_STATUSES = Object.keys(LOCATION_STATUS_LABEL) as [LocationStatus, ...LocationStatus[]];

const changeStatusSchema = z.object({
  locationId: z.uuid(),
  toStatus: z.enum(LOCATION_STATUSES),
  note: z.string().trim().max(500).optional(),
});

/** Ubah status lifecycle lokasi: validasi mesin transisi + histori + audit. */
export async function changeLocationStatus(
  _prev: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const parsed = changeStatusSchema.safeParse({
    locationId: formData.get("locationId"),
    toStatus: formData.get("toStatus"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("location.manage");
    await requireLocationAccess(user, d.locationId);
    const location = await db.location.findUniqueOrThrow({
      where: { id: d.locationId },
      select: { id: true, slug: true, status: true },
    });
    if (!canTransitionLocation(location.status, d.toStatus)) {
      return {
        error: `Transisi ${LOCATION_STATUS_LABEL[location.status]} → ${LOCATION_STATUS_LABEL[d.toStatus]} tidak diizinkan.`,
      };
    }

    await db.$transaction(async (tx) => {
      await tx.location.update({
        where: { id: location.id },
        data: {
          status: d.toStatus,
          // isActive = tampil di dashboard operasional: nyala saat mulai
          // berjalan, mati saat batal. Status lain tidak menyentuhnya.
          ...(d.toStatus === "berjalan" ? { isActive: true } : {}),
          ...(d.toStatus === "batal" ? { isActive: false } : {}),
        },
      });
      await tx.locationStatusHistory.create({
        data: {
          locationId: location.id,
          fromStatus: location.status,
          toStatus: d.toStatus,
          changedById: user.id,
          note: d.note ?? null,
        },
      });
    });
    await audit(user.id, "location.status_change", "location", location.id, {
      from: location.status,
      to: d.toStatus,
      note: d.note ?? null,
    });

    revalidatePath(`/lokasi/${location.slug}`, "layout");
    revalidatePath("/lokasi");
    revalidatePath("/");
    return { success: `Status lokasi → ${LOCATION_STATUS_LABEL[d.toStatus]}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}

/* ── Master data lokasi: alamat + koordinat (DECISIONS 134) ─────────────── */

const masterSchema = z.object({
  locationId: z.uuid(),
  village: z.string().trim().min(2, "Desa/kelurahan wajib diisi").max(120),
  district: z.string().trim().max(120).optional(),
  regency: z.string().trim().min(2, "Kabupaten/kota wajib diisi").max(120),
  province: z.string().trim().min(2, "Provinsi wajib diisi").max(120),
  gpsLat: z.string().trim().optional(),
  gpsLng: z.string().trim().optional(),
});

/**
 * Perbarui master data lokasi (alamat administratif + titik koordinat).
 * Koordinat dipakai peta, cap foto (fallback titik proyek), dan rule GPS —
 * karenanya edit di-audit. Isi keduanya atau kosongkan keduanya.
 */
export async function updateLocationMaster(
  _prev: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const parsed = masterSchema.safeParse({
    locationId: formData.get("locationId"),
    village: formData.get("village") ?? "",
    district: String(formData.get("district") ?? "").trim() || undefined,
    regency: formData.get("regency") ?? "",
    province: formData.get("province") ?? "",
    gpsLat: String(formData.get("gpsLat") ?? "").trim() || undefined,
    gpsLng: String(formData.get("gpsLng") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("location.manage");
    await requireLocationAccess(user, d.locationId);
    const coord = parseCoordinatePair(d.gpsLat, d.gpsLng);
    if (!coord.ok) return { error: coord.error };
    const { lat, lng } = coord;
    const before = await db.location.findUnique({
      where: { id: d.locationId },
      select: { slug: true, village: true, district: true, regency: true, province: true, gpsLat: true, gpsLng: true },
    });
    if (!before) return { error: "Lokasi tidak ditemukan." };

    await db.location.update({
      where: { id: d.locationId },
      data: {
        village: d.village,
        district: d.district ?? null,
        regency: d.regency,
        province: d.province,
        gpsLat: coordinateForDb(lat),
        gpsLng: coordinateForDb(lng),
      },
    });
    await audit(user.id, "location.master_update", "location", d.locationId, {
      before: {
        village: before.village,
        district: before.district,
        regency: before.regency,
        province: before.province,
        gps: before.gpsLat != null ? `${before.gpsLat},${before.gpsLng}` : null,
      },
      after: {
        village: d.village,
        district: d.district ?? null,
        regency: d.regency,
        province: d.province,
        gps: lat != null ? `${lat},${lng}` : null,
      },
    });
    revalidatePath(`/lokasi/${before.slug}`);
    revalidatePath("/peta");
    // Dashboard eksekutif kini hanya hidup di "/" — `/aktivitas` sudah jadi
    // pengalihan permanen, jadi merevalidasinya tidak menyegarkan apa pun.
    revalidatePath("/");
    return { success: "Master data lokasi tersimpan." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
