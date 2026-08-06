import "server-only";
import { db } from "@/lib/db";
import { pct } from "@/lib/money";
import { akhirHariKerja } from "@/lib/format";

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

export const COUNTED_REPORT_STATUSES = ["dikirim", "disetujui", "final"] as const;

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
 *  - revisi RAB & baseline yang dipakai adalah yang EFEKTIF pada tanggal itu
 *    (dibuat sebelum/pada `asOf` dan belum digantikan saat itu);
 *  - minggu rencana dihitung terhadap `asOf`, bukan jam dinding.
 *
 * Dipakai `finalSnapshot` laporan harian supaya dokumen resmi bertanggal 1 Juli
 * tidak memuat realisasi 20 Juli hanya karena difinalkan terlambat (audit Codex
 * 2026-07-28, CALC-01). Tanpa `asOf`, perilakunya persis seperti sebelumnya:
 * posisi terkini — itulah yang dipakai dashboard & halaman progress.
 */
export type ProgressAsOf = { asOf?: Date };

/** Progress banyak lokasi sekaligus (batched, bukan per-lokasi N+1). */
export async function getLocationsProgress(
  locationIds: string[],
  opts: ProgressAsOf = {},
): Promise<Map<string, LocationProgress>> {
  const result = new Map<string, LocationProgress>();
  if (locationIds.length === 0) return result;
  const asOf = opts.asOf;
  /**
   * Batas "efektif pada tanggal itu" = AKHIR hari kerjanya, bukan awalnya.
   *
   * `asOf` datang dari kolom tanggal kerja `@db.Date` yang tersimpan sebagai
   * UTC-midnight — di Jakarta itu pukul **07:00 WIB**. Memakainya apa adanya
   * memotong hari kerja pada jam tujuh pagi: baseline atau revisi yang
   * diaktifkan siang itu punya `createdAt` lebih besar dari batas, jadi gugur;
   * sementara versi lama yang `supersededAt`-nya siang itu justru lolos syarat
   * `supersededAt > asOf`. Akibatnya dokumen resmi HARI INI mencetak jadwal
   * yang tadi siang baru saja diganti, sedangkan layar workspace — yang membaca
   * baseline berstatus `aktif` — menampilkan jadwal barunya. Dua angka rencana
   * berbeda untuk tanggal yang sama, tanpa satu kata pun yang menjelaskannya
   * (laporan user 2026-08-06: rencana 23,30% di PDF vs 1,7% di layar).
   *
   * Maksud `asOf` (CALC-01) adalah versi yang EFEKTIF pada tanggal itu.
   * Baseline yang diaktifkan pukul 14:30 pada 6 Agustus jelas efektif pada
   * 6 Agustus. Jadi batas benarnya akhir hari, dan itulah yang dipakai di sini.
   *
   * Arah sebaliknya tetap dijaga: perubahan yang dibuat BESOK punya `createdAt`
   * di atas batas ini, jadi dokumen hari ini tidak ikut berubah — justru inilah
   * yang membuat cap "FINAL — ANGKA TERKUNCI" jadi benar.
   */
  const batasEfektif = asOf ? akhirHariKerja(asOf) : null;
  // Versi yang efektif pada `asOf`: dibuat ≤ batas dan belum digantikan saat itu.
  // Tanpa asOf: versi yang berstatus aktif sekarang.
  const efektif = batasEfektif
    ? {
        createdAt: { lte: batasEfektif },
        OR: [{ supersededAt: null }, { supersededAt: { gt: batasEfektif } }],
      }
    : { status: "aktif" as const };

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
      -- sementara blanko KKP menulis 0 — dua angka berbeda lagi.
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
        AND dr.status::text = ANY(${[...COUNTED_REPORT_STATUSES]}::text[])
        AND (${asOf ?? null}::date IS NULL OR dr.report_date <= ${asOf ?? null}::date)
        AND rn.kind = 'item'
        -- HANYA basis aktif. Laporan terhadap draft adendum TIDAK boleh
        -- menggerakkan angka resmi — adendumnya belum disetujui siapa pun
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
