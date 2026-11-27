import "server-only";
import { db } from "@/lib/db";
import { getLocationProgress } from "@/lib/progress";
import { bigintToString } from "@/lib/money";
import type { DailyReportStatus, LocationStatus } from "@/generated/prisma/enums";
import { akhirKontrakBerlaku } from "@/lib/progress-calc";
import { HARI_ADENDUM } from "@/lib/kontrak-berlaku";

/**
 * Data layer halaman Peta (port dari versi lama, adaptasi schema rebuild):
 * marker = lokasi ber-GPS (scoped penugasan); snapshot = ringkasan satu lokasi
 * saat titik diklik (identitas + kontrak + progress + laporan terakhir).
 */

export type PetaMarker = {
  id: string;
  slug: string;
  name: string;
  village: string;
  regency: string;
  province: string;
  lat: number;
  lng: number;
  status: LocationStatus;
  packageName: string;
  /** false = lokasi TARGET (belum mulai berjalan) — dibedakan di peta. */
  isActive: boolean;
};

/** Titik lokasi untuk peta — hanya yang punya koordinat. scopedIds null = semua lokasi ORGANISASI (audit B11). */
export async function getPetaMarkers(scopedIds: string[] | null, orgId: string): Promise<PetaMarker[]> {
  const locations = await db.location.findMany({
    where: {
      ...(scopedIds === null ? { package: { orgId } } : { id: { in: scopedIds } }),
      gpsLat: { not: null },
      gpsLng: { not: null },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      isActive: true,
      gpsLat: true,
      gpsLng: true,
      package: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const out: PetaMarker[] = [];
  for (const l of locations) {
    const lat = Number(l.gpsLat);
    const lng = Number(l.gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: l.id,
      slug: l.slug,
      name: l.name,
      village: l.village,
      regency: l.regency,
      province: l.province,
      lat,
      lng,
      status: l.status,
      packageName: l.package.name,
      isActive: l.isActive,
    });
  }
  return out;
}

/**
 * Lokasi dalam lingkup akses yang TIDAK bisa dipetakan karena koordinatnya
 * kosong. Tanpa daftar ini peta diam-diam menyembunyikannya, dan "tidak muncul"
 * terbaca "tidak ada" — padahal cuma titiknya yang belum diisi.
 */
export async function getLokasiTanpaKoordinat(
  scopedIds: string[] | null,
  orgId: string,
): Promise<{ id: string; slug: string; name: string; regency: string }[]> {
  return db.location.findMany({
    where: {
      ...(scopedIds === null ? { package: { orgId } } : { id: { in: scopedIds } }),
      OR: [{ gpsLat: null }, { gpsLng: null }],
    },
    select: { id: true, slug: true, name: true, regency: true },
    orderBy: { name: "asc" },
  });
}

export type LocationSnapshot = {
  id: string;
  slug: string;
  name: string;
  village: string;
  regency: string;
  province: string;
  status: LocationStatus;
  packageName: string;
  vendorName: string | null;
  contractNumber: string | null;
  /** Rupiah, BigInt diserialisasi ke string (aman JSON). */
  contractValue: string | null;
  /** ISO datetime string (kolom @db.Date). */
  startDate: string | null;
  endDate: string | null;
  planPct: number;
  realizedPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
  lastReport: { date: string; status: DailyReportStatus } | null;
  /**
   * Angka Kawal KNMP terbaru untuk lokasi yang berpasangan (DECISIONS 800) –
   * rujukan, bukan angka resmi; apa adanya dari Kawal. Diisi rute API HANYA
   * untuk peran ber-`kawal.view`; tanpa itu, atau tanpa pasangan, null.
   */
  kawal?: KawalPanelPeta | null;
};

/** Ringkasan Kawal untuk panel peta – angka saja, tanpa nama orang atau rupiah. */
export type KawalPanelPeta = {
  realisasiPct: number | null;
  rencanaPct: number | null;
  deviasiPct: number | null;
  mingguKe: number | null;
  totalMinggu: number | null;
  /** ISO – kapan data Kawal ini diambil. */
  diambil: string;
};

/** Ringkasan 1 lokasi untuk panel detail peta. null bila lokasi tidak ada. */
export async function getLocationSnapshot(locationId: string): Promise<LocationSnapshot | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      slug: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      package: {
        select: {
          name: true,
          contract: {
            select: {
              contractNumber: true,
              contractValue: true,
              startDate: true,
              endDate: true,
              ...HARI_ADENDUM,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!loc) return null;

  const [progress, lastReport] = await Promise.all([
    getLocationProgress(locationId),
    db.dailyReport.findFirst({
      where: { locationId },
      orderBy: { reportDate: "desc" },
      select: { reportDate: true, status: true },
    }),
  ]);

  const contract = loc.package.contract;
  const raw = {
    id: loc.id,
    slug: loc.slug,
    name: loc.name,
    village: loc.village,
    regency: loc.regency,
    province: loc.province,
    status: loc.status,
    packageName: loc.package.name,
    vendorName: contract?.vendor.name ?? null,
    contractNumber: contract?.contractNumber ?? null,
    contractValue: contract?.contractValue ?? null,
    startDate: contract?.startDate ?? null,
    // Akhir kontrak YANG BERLAKU (DECISIONS 773).
    endDate: contract ? akhirKontrakBerlaku(contract.endDate, contract.amendments) : null,
    planPct: progress.planPct,
    realizedPct: progress.realizedPct,
    deviationPct: progress.deviationPct,
    weekNumber: progress.weekNumber,
    totalWeeks: progress.totalWeeks,
    lastReport: lastReport ? { date: lastReport.reportDate, status: lastReport.status } : null,
  };
  // bigintToString me-round-trip JSON: BigInt → string, Date → ISO string.
  return bigintToString(raw) as unknown as LocationSnapshot;
}
