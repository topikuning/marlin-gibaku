import "server-only";
import { db } from "@/lib/db";
import { pct } from "@/lib/money";

/**
 * Calculation layer progress — SATU sumber untuk dashboard, workspace, laporan, export.
 *   grandTotal   = Σ amount node kind "kategori" pada revisi aktif
 *   realized     = Σ min(1, Σvolume/volumeRAB) × amount, atas item revisi AKTIF,
 *                  dari laporan status ≥ dikirim (dikirim/disetujui/final)
 *   deviationPct = realizedPct − planPct
 *
 * Formula realized DIUBAH pada DECISIONS 151 (sebelumnya Σ valueDone): rumusnya
 * kini identik dengan blanko KKP di `lib/progress-calc.ts`, supaya dashboard dan
 * laporan resmi mustahil menampilkan dua angka berbeda. Lihat DECISIONS 151
 * untuk alasan lengkapnya.
 */

/**
 * Rumahnya PINDAH ke `lifecycle.ts` (DECISIONS 415) dan di-ekspor ulang di sini
 * supaya tidak ada satu pun pemanggil lama yang perlu diubah.
 *
 * Sebabnya: file ini menyentuh basis data, jadi apa pun yang mengimpornya ikut
 * menyeret koneksi DB. Daftar status yang TERHITUNG adalah pengetahuan murni —
 * modul aturan (mis. pindah tanggal) harus bisa memakainya tanpa DB, dan
 * menyalinnya ke sana adalah cara paling mudah membuat dua daftar yang perlahan
 * berbeda.
 */
export { COUNTED_REPORT_STATUSES, VERIFIED_REPORT_STATUSES } from "./lifecycle";
import { COUNTED_REPORT_STATUSES, VERIFIED_REPORT_STATUSES } from "./lifecycle";

const WEEK_MS = 7 * 24 * 3600 * 1000;

export type LocationProgress = {
  locationId: string;
  grandTotal: bigint;
  realizedValue: bigint;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
  activeRevisionId: string | null;
  activeBaselineId: string | null;
};

/** Nomor minggu berjalan sejak startDate, clamp [1, totalWeeks]. */
/**
 * Minggu ke berapa proyek berjalan. **0 = belum mulai** (hari ini masih sebelum
 * SPMK) — dulu di-clamp ke minimal 1, sehingga paket yang SPMK-nya belum tiba
 * sudah dianggap berada di Minggu 1: rencana minggu 1 terbaca sebagai target
 * yang seharusnya sudah tercapai, realisasi 0, dan muncul deviasi negatif untuk
 * hari yang pekerjaannya belum boleh dimulai (DECISIONS 202).
 */
export function currentWeekNumber(startDate: Date, totalWeeks: number, now = new Date()): number {
  const wk = Math.floor((now.getTime() - startDate.getTime()) / WEEK_MS) + 1;
  if (wk < 1) return 0;
  return Math.min(wk, Math.max(totalWeeks, 1));
}

/** Plan % kumulatif pada minggu tertentu dari deret baseline (clamp minggu terakhir). */
export function planPctAtWeek(points: number[], weekNumber: number): number {
  if (points.length === 0) return 0;
  // Minggu 0 = belum mulai → rencana 0%. Tanpa ini, minggu 0 jatuh ke index 0
  // dan mengembalikan rencana MINGGU 1 (DECISIONS 202).
  if (weekNumber <= 0) return 0;
  const idx = Math.max(0, Math.min(weekNumber - 1, points.length - 1));
  return points[idx];
}

/**
 * Opsi perhitungan progress.
 *
 * `asOf` = hitung posisi PADA tanggal itu, bukan posisi hari ini:
 *  - hanya laporan dengan `reportDate <= asOf` yang dihitung;
 *  - minggu rencana dihitung terhadap `asOf`, bukan jam dinding.
 *
 * `asOf` TIDAK memilih versi. Revisi RAB & baseline kurva-S yang dipakai selalu
 * yang berstatus `aktif` — keputusan user 2026-08-06, lihat DECISIONS 275.
 *
 * Dipakai `finalSnapshot` laporan harian supaya dokumen resmi bertanggal 1 Juli
 * tidak memuat realisasi 20 Juli hanya karena difinalkan terlambat (audit Codex
 * 2026-07-28, CALC-01). Tanpa `asOf`, perilakunya persis seperti sebelumnya:
 * posisi terkini — itulah yang dipakai dashboard & halaman progress.
 */
/**
 * `statusLevel` (DECISIONS 426, CIP "Status progress harus dibedakan"):
 *  - `"dilaporkan"` (DEFAULT) — dikirim+disetujui+final = ANGKA RESMI existing.
 *    Tidak ada satu pun pemanggil lama yang berubah angkanya.
 *  - `"terverifikasi"` — disetujui+final saja. RUMUSNYA SAMA PERSIS (fungsi dan
 *    SQL yang sama); yang berbeda hanya saringan status laporan. Dipakai mesin
 *    kesiapan termin/PHO dan tampilan berlabel "Progress Terverifikasi".
 */
export type ProgressStatusLevel = "dilaporkan" | "terverifikasi";
export type ProgressAsOf = { asOf?: Date; statusLevel?: ProgressStatusLevel };

function statusesForLevel(level: ProgressStatusLevel | undefined): string[] {
  return level === "terverifikasi" ? [...VERIFIED_REPORT_STATUSES] : [...COUNTED_REPORT_STATUSES];
}

/** Progress banyak lokasi sekaligus (batched, bukan per-lokasi N+1). */
export async function getLocationsProgress(
  locationIds: string[],
  opts: ProgressAsOf = {},
): Promise<Map<string, LocationProgress>> {
  const result = new Map<string, LocationProgress>();
  if (locationIds.length === 0) return result;
  const asOf = opts.asOf;
  const countedStatuses = statusesForLevel(opts.statusLevel);
  /**
   * Dasar perhitungan SELALU versi yang berstatus `aktif` — revisi RAB maupun
   * baseline kurva-S. Keputusan user 2026-08-06:
   *
   *   *"intinya kalau baseline kurva-s aktif yang mana, itu yang dipakai
   *   dasar."*
   *
   * Sebelumnya `asOf` juga memilih VERSI yang berlaku pada tanggal itu. Aturan
   * itu dibuang, dan dua hal ikut beres sekaligus:
   *
   * 1. **Dua angka rencana untuk tanggal yang sama.** Layar workspace membaca
   *    baseline `aktif`, dokumen harian membaca baseline "yang berlaku pada
   *    tanggal laporan" — dan karena tanggal kerja `@db.Date` tersimpan sebagai
   *    tengah malam UTC (= 07:00 WIB), jadwal yang diganti siang hari gugur
   *    sedangkan jadwal lama yang baru saja digantikan justru lolos. Dokumen
   *    resmi mencetak rencana 23,30% sementara layar menulis 1,7%.
   *
   * 2. **Basis pembilang & penyebut yang tidak sepadan.** `realized` di SQL di
   *    bawah SELALU mengikat revisi `aktif` (`rr.status = 'aktif'`), sedangkan
   *    `grandTotal` dulu memakai revisi hasil pemilihan `asOf`. Untuk laporan
   *    lampau yang dilewati adendum, rasionya menjadi
   *    realisasi(revisi baru) ÷ total(revisi lama) — pecahan yang penyebut dan
   *    pembilangnya bukan dari dokumen yang sama. Cacat ini SENYAP: tidak ada
   *    galat, angkanya cuma salah.
   *
   * `asOf` tetap ada dan tetap berarti, tapi hanya untuk hal yang memang soal
   * WAKTU, bukan soal versi: laporan mana yang ikut dihitung
   * (`report_date <= asOf`) dan minggu ke berapa tanggal itu jatuh. Itulah inti
   * CALC-01 — dokumen bertanggal 1 Juli tidak boleh memuat realisasi 20 Juli.
   *
   * Konsekuensi yang DISENGAJA: mengubah kurva-S menggeser deviasi pada seluruh
   * dokumen, termasuk yang bertanggal lampau, karena deviasi memang diukur
   * terhadap rencana yang BERLAKU. Lihat DECISIONS 275.
   */
  const efektif = { status: "aktif" as const };

  const [revisions, baselines, contracts] = await Promise.all([
    db.rabRevision.findMany({
      where: { locationId: { in: locationIds }, ...efektif },
      select: { id: true, locationId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.baseline.findMany({
      where: { locationId: { in: locationIds }, ...efektif },
      select: { id: true, locationId: true, contractDays: true, createdAt: true, points: { select: { weekNumber: true, plannedPct: true }, orderBy: { weekNumber: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.contract.findMany({
      where: { package: { locations: { some: { id: { in: locationIds } } } } },
      select: { startDate: true, package: { select: { locations: { select: { id: true } } } } },
    }),
  ]);

  // Urutan createdAt desc → entri PERTAMA per lokasi adalah versi terakhir yang
  // efektif pada titik waktu yang diminta.
  const revByLoc = new Map<string, string>();
  for (const r of revisions) if (!revByLoc.has(r.locationId)) revByLoc.set(r.locationId, r.id);
  const baseByLoc = new Map<string, (typeof baselines)[number]>();
  for (const b of baselines) if (!baseByLoc.has(b.locationId)) baseByLoc.set(b.locationId, b);
  const startByLoc = new Map<string, Date | null>();
  for (const c of contracts) {
    for (const l of c.package.locations) startByLoc.set(l.id, c.startDate);
  }

  const revIds = revisions.map((r) => r.id);
  // grandTotal per revisi aktif = Σ amount kategori
  const catSums = revIds.length
    ? await db.rabNode.groupBy({
        by: ["revisionId"],
        where: { revisionId: { in: revIds }, kind: "kategori" },
        _sum: { amount: true },
      })
    : [];
  const totalByRev = new Map(catSums.map((c) => [c.revisionId, c._sum.amount ?? 0n]));

  // Realized per lokasi = Σ (prestasi item × amount item revisi AKTIF), prestasi
  // dibatasi 100%. Basisnya SAMA PERSIS dengan blanko KKP (lib/progress-calc.ts,
  // DECISIONS 151) — dashboard dan laporan resmi tidak boleh menampilkan dua
  // angka berbeda untuk hal yang sama.
  //
  // Sengaja BUKAN Σ value_done: kolom itu dibekukan memakai harga satuan revisi
  // yang aktif SAAT laporan dibuat, jadi satu adendum yang mengubah harga
  // langsung membuat dashboard melenceng dari laporan tanpa ada salah input.
  // Volume yang melebihi RAB (mis. adendum mengurangi volume setelah laporan
  // ada) juga ikut dibatasi, sama seperti di laporan.
  const realizedPerLoc = await db.$queryRaw<{ location_id: string; realized: bigint }[]>`
    SELECT t.location_id, COALESCE(SUM(t.realized), 0)::bigint AS realized
    FROM (
      -- GREATEST/LEAST harus PERSIS sepadan dengan prestasiPct() di
      -- progress-calc.ts: batas atas 100% DAN batas bawah 0, serta volume RAB
      -- ≤ 0 diperlakukan sebagai "tidak bisa dihitung" (bukan bagi negatif).
      -- Tanpa batas bawah, koreksi bervolume negatif membuat dashboard minus
      -- sementara blanko KKP menulis 0 – dua angka berbeda lagi.
      SELECT dr.location_id AS location_id,
             GREATEST(0.0, LEAST(1.0,
               SUM(dri.volume_done) / NULLIF(GREATEST(rn.volume, 0), 0)
             )) * rn.amount AS realized
      FROM daily_report_items dri
      JOIN daily_reports dr ON dr.id = dri.report_id
      JOIN rab_nodes rn ON rn.lineage_key = dri.lineage_key
      JOIN rab_revisions rr ON rr.id = rn.revision_id
        AND rr.location_id = dr.location_id AND rr.status = 'aktif'
      WHERE dr.location_id = ANY(${locationIds}::uuid[])
        AND dr.status::text = ANY(${countedStatuses}::text[])
        AND (${asOf ?? null}::date IS NULL OR dr.report_date <= ${asOf ?? null}::date)
        AND rn.kind = 'item'
        -- HANYA basis aktif. Laporan terhadap draft adendum TIDAK boleh
        -- menggerakkan angka resmi – adendumnya belum disetujui siapa pun
        -- (DECISIONS 210). Tanpa baris ini, item yang lineage-nya ada di kedua
        -- revisi akan ikut terhitung dan progres resmi naik tanpa dasar.
        AND dri.basis = 'aktif'
      GROUP BY dr.location_id, rn.id, rn.volume, rn.amount
    ) t
    GROUP BY t.location_id
  `;
  const realizedByLoc = new Map(realizedPerLoc.map((r) => [r.location_id, BigInt(r.realized)]));

  for (const locId of locationIds) {
    const revId = revByLoc.get(locId) ?? null;
    const baseline = baseByLoc.get(locId);
    const grandTotal = revId ? (totalByRev.get(revId) ?? 0n) : 0n;
    const realizedValue = realizedByLoc.get(locId) ?? 0n;
    const points = baseline?.points.map((p) => Number(p.plannedPct)) ?? [];
    const totalWeeks = points.length || Math.ceil((baseline?.contractDays ?? 0) / 7);
    const start = startByLoc.get(locId);
    const weekNumber = start ? currentWeekNumber(start, totalWeeks, asOf ?? new Date()) : 1;
    const planPct = planPctAtWeek(points, weekNumber);
    const realizedPct = pct(realizedValue, grandTotal);
    result.set(locId, {
      locationId: locId,
      grandTotal,
      realizedValue,
      realizedPct,
      planPct,
      deviationPct: realizedPct - planPct,
      weekNumber,
      totalWeeks,
      activeRevisionId: revId,
      activeBaselineId: baseline?.id ?? null,
    });
  }
  return result;
}

export async function getLocationProgress(
  locationId: string,
  opts: ProgressAsOf = {},
): Promise<LocationProgress> {
  const map = await getLocationsProgress([locationId], opts);
  return (
    map.get(locationId) ?? {
      locationId,
      grandTotal: 0n,
      realizedValue: 0n,
      realizedPct: 0,
      planPct: 0,
      deviationPct: 0,
      weekNumber: 1,
      totalWeeks: 0,
      activeRevisionId: null,
      activeBaselineId: null,
    }
  );
}

/**
 * Kumulatif volume per lineageKey utk satu lokasi (laporan status counted).
 *
 * Tanpa `upToDate` → kumulatif TOTAL lintas semua tanggal: dipakai guard anti-lebih
 * (total realisasi tak boleh > volume RAB) dan sisa volume di form input.
 *
 * Dengan `upToDate` → kumulatif "s/d tanggal itu" (reportDate ≤ upToDate): dipakai
 * tampilan/cetak KKP per hari, supaya laporan tanggal lama TIDAK ikut menghitung
 * realisasi hari sesudahnya (mis. laporan 12 Juli tak boleh terhitung volume 13 Juli).
 */
export type BasisLaporan = "aktif" | "draft_adendum";

/**
 * Basis mana yang ikut dihitung (DECISIONS 210).
 * - `aktif` (DEFAULT) — hanya laporan terhadap RAB kontrak. SEMUA angka resmi
 *   memakai ini: progres, kurva-S, deviasi, keuangan, blanko KKP. Tidak boleh
 *   berubah gara-gara ada pengajuan adendum yang belum disetujui siapa pun.
 * - `semua` — termasuk laporan terhadap draft adendum. Untuk laporan "seandainya
 *   adendum disetujui", dan untuk guard volume di jalur draft.
 */
export type CakupanBasis = "aktif" | "semua";

export async function cumulativeVolumeByLineage(
  locationId: string,
  upToDate?: Date,
  cakupan: CakupanBasis = "aktif",
): Promise<Map<string, number>> {
  const rows = await db.dailyReportItem.groupBy({
    by: ["lineageKey"],
    where: {
      ...(cakupan === "aktif" ? { basis: "aktif" } : {}),
      report: {
        locationId,
        status: { in: [...COUNTED_REPORT_STATUSES] },
        ...(upToDate ? { reportDate: { lte: upToDate } } : {}),
      },
    },
    _sum: { volumeDone: true },
  });
  return new Map(rows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]));
}

/* ── Progres "seandainya adendum disetujui" (DECISIONS 210) ──────────────── */

export type ProgresDraftAdendum = {
  revisionId: string;
  revisionNo: number;
  /** Nilai RAB draft (Σ amount kategori draft). */
  grandTotal: bigint;
  /** Terpasang menurut draft, menghitung laporan basis aktif MAUPUN draft. */
  realizedValue: bigint;
  realizedPct: number;
  /** Berapa baris laporan yang dicatat terhadap draft (bukan RAB resmi). */
  barisBasisDraft: number;
  /** Terpasang menurut RAB aktif — pembanding, angka resmi. */
  realizedValueResmi: bigint;
};

/**
 * Progres terhadap DRAFT adendum yang sedang diajukan.
 *
 * Perhitungannya SEPADAN dengan jalur resmi (prestasi item dibatasi 0–100%,
 * dikalikan amount item) — bedanya hanya dua: revisi yang dipakai adalah
 * DRAFT, dan laporan yang dihitung mencakup KEDUA basis. Alasannya: pekerjaan
 * yang sudah dilaporkan terhadap RAB aktif tetap pekerjaan yang sama; kalau
 * adendum disetujui, ia tidak hilang.
 *
 * Ini BUKAN angka resmi dan tidak boleh dipakai untuk termin, kurva-S, atau
 * blanko KKP. Null bila lokasi tidak sedang punya draft.
 */
export async function getProgresDraftAdendum(
  locationId: string,
  asOf?: Date,
): Promise<ProgresDraftAdendum | null> {
  const draft = await db.rabRevision.findFirst({
    where: { locationId, status: "draft" },
    select: { id: true, revisionNo: true },
  });
  if (!draft) return null;

  const [catSum, barisBasisDraft, rows, resmi] = await Promise.all([
    db.rabNode.aggregate({
      where: { revisionId: draft.id, kind: "kategori" },
      _sum: { amount: true },
    }),
    db.dailyReportItem.count({
      where: {
        basis: "draft_adendum",
        report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
      },
    }),
    db.$queryRaw<{ realized: bigint }[]>`
      SELECT COALESCE(SUM(t.realized), 0)::bigint AS realized
      FROM (
        SELECT GREATEST(0.0, LEAST(1.0,
                 SUM(dri.volume_done) / NULLIF(GREATEST(rn.volume, 0), 0)
               )) * rn.amount AS realized
        FROM daily_report_items dri
        JOIN daily_reports dr ON dr.id = dri.report_id
        JOIN rab_nodes rn ON rn.lineage_key = dri.lineage_key AND rn.revision_id = ${draft.id}::uuid
        WHERE dr.location_id = ${locationId}::uuid
          AND dr.status::text = ANY(${[...COUNTED_REPORT_STATUSES]}::text[])
          AND (${asOf ?? null}::date IS NULL OR dr.report_date <= ${asOf ?? null}::date)
          AND rn.kind = 'item'
        GROUP BY rn.id, rn.volume, rn.amount
      ) t
    `,
    getLocationProgress(locationId, asOf ? { asOf } : {}),
  ]);

  const grandTotal = catSum._sum.amount ?? 0n;
  const realizedValue = BigInt(rows[0]?.realized ?? 0n);
  return {
    revisionId: draft.id,
    revisionNo: draft.revisionNo,
    grandTotal,
    realizedValue,
    realizedPct: pct(realizedValue, grandTotal),
    barisBasisDraft,
    realizedValueResmi: resmi.realizedValue,
  };
}
