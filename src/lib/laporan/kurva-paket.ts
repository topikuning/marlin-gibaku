import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { getScurveSeriesPaket } from "@/lib/baseline";
import { lingkupLokasi } from "@/lib/package/lingkup-lokasi";
import { getPeriodBounds, getPeriodReport, type PeriodBounds, type PeriodReport } from "@/lib/periodic-report";
import { rincianKurvaPaket } from "@/lib/progress-calc";

/**
 * KURVA-S PAKET (gabungan seluruh lokasi) sebagai dokumen – PDF & Excel
 * (DECISIONS 678). Bentuknya Time Schedule KKP yang sama dengan per lokasi,
 * hanya barisnya LOKASI, bukan kategori pekerjaan:
 * - bobot baris = porsi RAB aktif lokasi di paket,
 * - isi minggu = porsi × kenaikan rencana lokasi itu (`rincianKurvaPaket`),
 * - kumulatif rencana & realisasi = `gabungKurvaS` – angka yang SAMA dengan
 *   kartu Kurva-S paket di layar.
 *
 * Lokasinya persis yang dihitung kartu itu: yang terlihat oleh pengguna, tidak
 * dicabut lewat adendum, dan punya baseline + RAB aktif. Yang tidak ikut
 * disebut jumlahnya di catatan dokumen, bukan didiamkan.
 *
 * Penyaji Time Schedule bekerja di atas `PeriodReport`, jadi laporan ini
 * dirakit dari laporan lokasi pertama (kop kontrak, penanda tangan dokumen
 * jadwal, periode minggu) lalu bagian lokasinya diganti angka paket. Bagian
 * rincian lokasi itu dikosongkan supaya tidak ada angka satu lokasi yang ikut
 * terbawa.
 */
export type KurvaPaketDokumen = {
  report: PeriodReport;
  bounds: PeriodBounds;
  /** Lokasi pertama yang ikut – sumber kop kontrak & penanda tangan. */
  lokasiAcuanId: string;
  paket: { id: string; name: string };
  catatan: string | null;
};

export async function susunKurvaPaket(
  packageId: string,
  /** null = penyusun di latar (berkas termin, DECISIONS 721): tanpa saringan akses. */
  user: SessionUser | null,
): Promise<KurvaPaketDokumen | "tidak_ada" | "kosong"> {
  const scoped = user ? await accessibleLocationIds(user) : null;
  const pkg = await db.package.findFirst({
    where: { id: packageId, ...(user ? packageScopeWhere(user, scoped) : {}) },
    select: {
      id: true,
      name: true,
      locations: {
        where: scoped === null ? undefined : { id: { in: scoped } },
        // Urutan yang sama dengan halaman paket – warna garis & nomor baris
        // mengikuti lokasinya.
        orderBy: { name: "asc" },
        select: { id: true, name: true, regency: true, province: true },
      },
    },
  });
  if (!pkg) return "tidak_ada";

  const idLokasi = pkg.locations.map((l) => l.id);
  const lingkup = await lingkupLokasi(idLokasi);
  const idIkut = idLokasi.filter((id) => !lingkup.dicabut.has(id));
  const kurva = await getScurveSeriesPaket(idIkut);
  if (kurva.dihitung === 0) return "kosong";

  const acuan = kurva.perLokasi[0].locationId;
  const bounds = await getPeriodBounds(acuan, { assume: true });
  if (!bounds) return "kosong";
  const dasar = await getPeriodReport(acuan, "mingguan", bounds.currentWeek, { assume: true });
  if (!dasar) return "kosong";

  const byId = new Map(pkg.locations.map((l) => [l.id, l]));
  const ikut = kurva.perLokasi.map((d) => byId.get(d.locationId)!);
  const rincian = rincianKurvaPaket(kurva.perLokasi);
  const unik = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(", ");

  const report: PeriodReport = {
    ...dasar,
    n: kurva.currentWeek,
    totalWeeks: kurva.totalWeeks,
    header: {
      ...dasar.header,
      locationName: `${ikut.length} lokasi`,
      village: ikut.map((l) => l.name).join(", "),
      district: null,
      regency: unik(ikut.map((l) => l.regency)),
      province: unik(ikut.map((l) => l.province)),
      locationValue: kurva.grandTotal,
      nilaiKontrakLokasi: undefined,
    },
    scurve: { planPct: kurva.planPct, actualPct: kurva.actualPct, currentWeek: kurva.currentWeek },
    kurvaSchedule: rincian.map((r, i) => ({
      lineageKey: kurva.perLokasi[i].locationId,
      code: String(i + 1),
      name: ikut[i].name,
      weekly: r.weekly,
    })),
    // Rincian lokasi acuan TIDAK ikut ke dokumen paket.
    categories: [],
    progresKategori: [],
    realisasiKategoriMingguan: [],
    tenaga: [],
    material: [],
    alat: [],
    kendala: [],
  };

  const tidakIkut = idLokasi.length - kurva.dihitung;
  const catatan = [
    bounds.assumed
      ? `SPMK belum diterbitkan. Minggu dihitung dari asumsi mulai tanggal kontrak (durasi ${dasar.header.masaPelaksanaanHari} hari).`
      : null,
    tidakIkut > 0
      ? `${tidakIkut} lokasi belum punya baseline kurva-S atau RAB aktif, atau sudah dicabut lewat adendum, jadi TIDAK ikut dihitung. Kurva ini belum mewakili seluruh paket.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { report, bounds, lokasiAcuanId: acuan, paket: { id: pkg.id, name: pkg.name }, catatan: catatan || null };
}
