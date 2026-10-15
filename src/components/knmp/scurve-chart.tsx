import type { ScurveSeries } from "@/lib/baseline";
import { ScurveChartInteraktif, type DeretLokasiKurva } from "./scurve-chart-interaktif";

/**
 * Kurva-S rencana vs realisasi (SVG, tanpa lib chart). Port dari b6e77af
 * src/components/knmp/scurve-chart.tsx; warna memakai CSS var design token.
 * X = minggu, Y = progress kumulatif %.
 *
 * Pembungkus tanpa "use client": hanya angka yang dibutuhkan yang menyeberang
 * ke peramban (deret paket membawa `grandTotal` BigInt yang tidak perlu ikut).
 * Interaksinya – angka saat disorot, garis per lokasi – di
 * `scurve-chart-interaktif.tsx` (DECISIONS 677).
 */
export function ScurveChart({
  series,
  forecast,
  lokasi,
}: {
  series: Pick<ScurveSeries, "totalWeeks" | "currentWeek" | "planPct" | "actualPct">;
  /** Garis prognosa (panjang totalWeeks; null utk minggu sebelum titik aktual). */
  forecast?: (number | null)[] | null;
  /** Realisasi tiap lokasi – hanya kurva paket. Urutannya tetap supaya warna ikut lokasinya. */
  lokasi?: DeretLokasiKurva[];
}) {
  if (series.totalWeeks === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Belum ada baseline kurva-S untuk lokasi ini. Impor RAB untuk membuatnya otomatis.
      </p>
    );
  }
  return (
    <ScurveChartInteraktif
      totalWeeks={series.totalWeeks}
      currentWeek={series.currentWeek}
      planPct={series.planPct}
      actualPct={series.actualPct}
      forecast={forecast ?? null}
      lokasi={lokasi ?? []}
    />
  );
}
