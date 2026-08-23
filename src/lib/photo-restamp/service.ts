import "server-only";
import { logoPerusahaanDataUri } from "@/lib/photo-stamp/logo-perusahaan";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_STAMP_ACCENT, getPhotoStampConfig, type StampSize } from "@/lib/photo-stamp/config";
import { DEFAULT_STAMP_TZ, generatePhotoId, locationCodeFromName } from "@/lib/photo-stamp/format";
import { overlayAlphaFor } from "@/lib/photo-stamp/renderer";
import type { PhotoStamp } from "@/lib/photos";
import type { Prisma } from "@/generated/prisma/client";
import type { PhotoGpsSource, PhotoMetadataSource } from "@/generated/prisma/enums";

/**
 * Nilai cap foto — SATU bentuk yang dipakai form, riwayat revisi, dan renderer
 * (DECISIONS 198). Dipisah dari `photos.ts` supaya perbaikan cap tidak
 * menduplikasi aturan penandaan; kalau duplikat, cap perbaikan cepat atau
 * lambat akan berbeda aturan dari cap unggahan.
 */
export type NilaiCap = {
  /** null = jam jepret tidak diketahui → cap menulis tanggal saja. */
  takenAt: Date;
  jamDiketahui: boolean;
  lat: number | null;
  lng: number | null;
  gpsSource: PhotoGpsSource;
  timeSource: PhotoMetadataSource;
  locationLabel: string | null;
  companyName: string | null;
  /** Kunci R2 logo perusahaan — dipakai cap ulang juga (DECISIONS 424). */
  companyLogoKey?: string | null;
  reporterName: string | null;
  categoryName: string | null;
  workName: string | null;
  photoId: string | null;
};

const SIZE_SCALE: Record<StampSize, number> = { compact: 0.85, standard: 1, large: 1.15 };

/**
 * Penanda yang WAJIB muncul di cap untuk nilai yang bukan bacaan alat.
 * Aturannya satu tempat: koordinat cadangan titik proyek dan nilai yang
 * diketik manusia sama-sama tidak boleh tampil sebagai fakta (DECISIONS 197).
 */
export function coordNoteFor(src: PhotoGpsSource): string | null {
  if (src === "project") return "titik proyek";
  if (src === "manual") return "diisi manual";
  return null;
}

export function timeNoteFor(v: Pick<NilaiCap, "jamDiketahui" | "timeSource">): string | null {
  if (!v.jamDiketahui) return "jam tidak tercatat";
  if (v.timeSource === "manual") return "diisi manual";
  if (v.timeSource === "server") return "waktu unggah";
  return null;
}

/** Bentuk `PhotoStamp` siap render dari nilai cap + konfigurasi sistem. */
export async function stampDariNilai(v: NilaiCap): Promise<PhotoStamp> {
  let cfg: Awaited<ReturnType<typeof getPhotoStampConfig>> | null = null;
  try {
    cfg = await getPhotoStampConfig();
  } catch {
    cfg = null;
  }
  return {
    takenAt: v.takenAt,
    lat: v.lat,
    lng: v.lng,
    locationLabel: v.locationLabel,
    companyName: v.companyName,
    companyLogo: await logoPerusahaanDataUri(v.companyLogoKey),
    reporterName: v.reporterName,
    categoryName: v.categoryName,
    workName: v.workName,
    photoId: v.photoId,
    accentColor: cfg?.accentColor ?? DEFAULT_STAMP_ACCENT,
    overlayAlpha: overlayAlphaFor(cfg?.overlayStrength ?? "auto"),
    sizeScale: SIZE_SCALE[cfg?.size ?? "standard"],
    timezone: DEFAULT_STAMP_TZ,
    showCoordinate: cfg?.showCoordinates ?? true,
    showReporter: cfg?.showReporter ?? true,
    showPhotoId: cfg?.showPhotoId ?? true,
    timeNote: timeNoteFor(v),
    coordNote: coordNoteFor(v.lat == null ? "none" : v.gpsSource),
    dateOnly: !v.jamDiketahui,
  };
}

/** Bentuk ringkas untuk disimpan di riwayat revisi (JSON, stabil & terbaca). */
export function ringkasNilai(v: NilaiCap): Record<string, unknown> {
  return {
    waktu: v.jamDiketahui ? v.takenAt.toISOString() : v.takenAt.toISOString().slice(0, 10),
    jamDiketahui: v.jamDiketahui,
    sumberWaktu: v.timeSource,
    lat: v.lat,
    lng: v.lng,
    sumberKoordinat: v.gpsSource,
    lokasi: v.locationLabel,
    perusahaan: v.companyName,
    pelapor: v.reporterName,
    kategori: v.categoryName,
    photoId: v.photoId,
  };
}

export type KonteksFoto = {
  photoId: string;
  locationId: string | null;
  locationName: string | null;
  locationSlug: string | null;
  companyName: string | null;
  /** Kunci R2 logo perusahaan — dipakai cap ulang juga (DECISIONS 424). */
  companyLogoKey?: string | null;
  reporterName: string | null;
  categoryName: string | null;
  workName: string | null;
  projectLat: number | null;
  projectLng: number | null;
  workDate: Date | null;
  originalKey: string | null;
  originalPurgedAt: Date | null;
  r2Key: string;
  thumbnailKey: string | null;
  stampRevision: number;
  /** Putaran kumulatif terhadap berkas asli, derajat (DECISIONS 424c). */
  rotationDeg: number;
  saatIni: NilaiCap;
};

/**
 * Baca foto + SEMUA data yang membentuk capnya, apa adanya dari DB SEKARANG.
 * Inilah "ambil ulang": kalau koordinat lokasi sudah dibetulkan atau nama
 * perusahaan berubah sejak foto diunggah, nilai usulan di sini sudah yang baru.
 */
export async function konteksFoto(id: string): Promise<KonteksFoto | null> {
  const p = await db.photo.findUnique({
    where: { id },
    select: {
      id: true,
      r2Key: true,
      thumbnailKey: true,
      originalKey: true,
      originalPurgedAt: true,
      exifTakenAt: true,
      exifGpsLat: true,
      exifGpsLng: true,
      gpsSource: true,
      metadataSource: true,
      stampPhotoId: true,
      stampRevision: true,
      rotationDeg: true,
      locationId: true,
      uploadedById: true,
      // lineageKey ikut dibaca: badge cap = BANGUNAN/kategori RAB, dan
      // bangunannya diturunkan dari akar lineage (DECISIONS 214/218).
      reportItem: { select: { lineageKey: true, rabNode: { select: { name: true } } } },
      report: { select: { reportDate: true, locationId: true } },
      activity: { select: { title: true, activityDate: true, locationId: true } },
      location: {
        select: {
          id: true,
          name: true,
          slug: true,
          gpsLat: true,
          gpsLng: true,
          package: {
            select: {
              organization: { select: { name: true } },
              contract: { select: { vendor: { select: { name: true, logoKey: true } } } },
            },
          },
        },
      },
    },
  });
  if (!p) return null;

  // Photo.uploadedById TIDAK punya relasi di skema — nama pelapor diambil
  // terpisah (pola yang sama dipakai galeri foto).
  const pelapor = p.uploadedById
    ? await db.user.findUnique({ where: { id: p.uploadedById }, select: { fullName: true } })
    : null;

  const num = (v: { toString(): string } | null) => (v == null ? null : Number(v.toString()));
  const projectLat = num(p.location?.gpsLat ?? null);
  const projectLng = num(p.location?.gpsLng ?? null);
  const workDate = p.report?.reportDate ?? p.activity?.activityDate ?? null;
  // Jam dianggap diketahui hanya bila sumbernya memang membawa jam.
  const jamDiketahui = p.metadataSource !== "server";

  // Bangunan/kategori item — dari revisi RAB AKTIF lokasi ini. Null bila
  // kategorinya sudah tidak ada lagi (mis. dihapus adendum): ditulis apa
  // adanya, tidak ditebak.
  let bangunanCap: string | null = null;
  const lkCap = p.reportItem?.lineageKey ?? null;
  const locIdCap = p.locationId ?? p.report?.locationId ?? p.activity?.locationId ?? null;
  if (lkCap && locIdCap) {
    const revAktif = await db.rabRevision.findFirst({
      where: { locationId: locIdCap, status: "aktif" },
      select: { id: true },
    });
    if (revAktif) {
      const kat = await db.rabNode.findFirst({
        where: { revisionId: revAktif.id, kind: "kategori", lineageKey: lkCap.split("#")[0] },
        select: { code: true, name: true },
      });
      if (kat) bangunanCap = kat.code ? `${kat.code}. ${kat.name}` : kat.name;
    }
  }

  return {
    photoId: p.id,
    locationId: p.locationId ?? p.report?.locationId ?? p.activity?.locationId ?? null,
    locationName: p.location?.name ?? null,
    locationSlug: p.location?.slug ?? null,
    companyName:
      p.location?.package.contract?.vendor?.name ?? p.location?.package.organization.name ?? null,
    companyLogoKey: p.location?.package.contract?.vendor?.logoKey ?? null,
    reporterName: pelapor?.fullName ?? null,
    categoryName: bangunanCap ?? p.activity?.title ?? null,
    workName: p.reportItem?.rabNode.name ?? null,
    projectLat,
    projectLng,
    workDate,
    originalKey: p.originalKey,
    originalPurgedAt: p.originalPurgedAt,
    r2Key: p.r2Key,
    thumbnailKey: p.thumbnailKey,
    stampRevision: p.stampRevision,
    rotationDeg: p.rotationDeg,
    saatIni: {
      takenAt: p.exifTakenAt ?? workDate ?? new Date(),
      jamDiketahui,
      lat: num(p.exifGpsLat),
      lng: num(p.exifGpsLng),
      gpsSource: p.gpsSource,
      timeSource: p.metadataSource,
      locationLabel: p.location?.name ?? null,
      companyName:
        p.location?.package.contract?.vendor?.name ?? p.location?.package.organization.name ?? null,
      companyLogoKey: p.location?.package.contract?.vendor?.logoKey ?? null,
      reporterName: pelapor?.fullName ?? null,
      categoryName: bangunanCap ?? p.activity?.title ?? null,
    workName: p.reportItem?.rabNode.name ?? null,
      photoId: p.stampPhotoId,
    },
  };
}

/**
 * Photo ID untuk foto lama yang belum punya (kolom baru). Dibuat sekali lalu
 * disimpan, jadi setelah ini identitasnya tidak berubah lagi.
 */
export function photoIdCadangan(k: KonteksFoto, takenAt: Date): string {
  return generatePhotoId(
    locationCodeFromName(k.locationName ?? k.locationSlug ?? "FOTO"),
    takenAt,
    (k.stampRevision % 99) + 1,
    DEFAULT_STAMP_TZ,
  );
}

/* ── Filter arsip berkas asli ────────────────────────────────────────────── */

export const filterArsipSchema = z.object({
  packageId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  dariTanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sampaiTanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type FilterArsip = z.infer<typeof filterArsipSchema>;

/**
 * `where` arsip asli yang MASIH ADA, dibatasi scope lokasi user. Dipakai
 * bersama oleh ringkasan (jumlah + ukuran) dan penghapusannya, supaya angka
 * yang dikonfirmasi user PERSIS yang terhapus — bukan dua query yang mirip.
 *
 * Sengaja BUKAN di modul "use server": setiap export di sana menjadi endpoint
 * yang bisa dipanggil siapa saja.
 */
export function whereArsip(f: FilterArsip, scope: string[] | null): Prisma.PhotoWhereInput {
  const and: Prisma.PhotoWhereInput[] = [{ originalKey: { not: null } }];
  if (scope !== null) and.push({ locationId: { in: scope } });
  if (f.locationId) and.push({ locationId: f.locationId });
  if (f.packageId) and.push({ location: { packageId: f.packageId } });
  if (f.dariTanggal) and.push({ createdAt: { gte: new Date(`${f.dariTanggal}T00:00:00+07:00`) } });
  if (f.sampaiTanggal) and.push({ createdAt: { lte: new Date(`${f.sampaiTanggal}T23:59:59+07:00`) } });
  return { AND: and };
}
