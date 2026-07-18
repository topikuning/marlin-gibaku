"use client";

import { useActionState, useMemo, useState } from "react";
import { SlidersHorizontal, TrendingUp, RotateCcw } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { saveManualBaselineAction, type RabActionState } from "../rab/actions";

/** Validasi bentuk kurva di klien (server tetap validasi ulang saat simpan). */
function validate(points: number[]): string | null {
  if (points.length === 0) return "Deret rencana kosong.";
  let prev = -Infinity;
  for (const [i, p] of points.entries()) {
    if (!Number.isFinite(p) || p < 0 || p > 100) return `Minggu ${i + 1}: nilai di luar 0–100.`;
    if (p < prev - 1e-9) return `Minggu ${i + 1}: kurva turun (${prev}→${p}) — harus naik.`;
    prev = p;
  }
  const last = points[points.length - 1];
  if (Math.abs(last - 100) > 0.5) return `Minggu terakhir harus 100% (±0,5), sekarang ${last}%.`;
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Editor kurva-S manual (best-practice): tabel % kumulatif per minggu +
 * pratinjau grafik langsung + validasi (monoton, mulai 0, akhir 100). Simpan =
 * baseline BARU source "manual" (histori utuh). Field pengguna gaptek → angka
 * per minggu dgn tombol bantu, bukan drag rumit.
 */
export function BaselineEditor({
  locationId,
  baselineId,
  initial,
}: {
  locationId: string;
  baselineId: string;
  initial: number[];
}) {
  const [pts, setPts] = useState<number[]>(() => initial.map(r1));
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    saveManualBaselineAction,
    undefined,
  );

  const n = pts.length;
  const invalid = useMemo(() => validate(pts), [pts]);
  const dirty = useMemo(
    () => pts.some((p, i) => Math.abs(p - r1(initial[i] ?? 0)) > 1e-9),
    [pts, initial],
  );

  const setAt = (i: number, v: number) =>
    setPts((prev) => prev.map((p, j) => (j === i ? v : p)));

  /** Paksa monoton naik (tiap minggu ≥ minggu sebelumnya), clamp 0..100. */
  const forceMonotonic = () =>
    setPts((prev) => {
      let run = 0;
      return prev.map((p) => {
        run = Math.min(100, Math.max(run, Math.max(0, Math.min(100, p))));
        return r1(run);
      });
    });

  /** Skala seluruh deret supaya minggu terakhir = 100% (proporsional). */
  const scaleTo100 = () =>
    setPts((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last <= 0) return prev;
      return prev.map((p) => r1(Math.min(100, (p / last) * 100)));
    });

  const reset = () => setPts(initial.map(r1));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Pratinjau langsung */}
      <div>
        <ScurveChart
          series={{
            totalWeeks: n,
            currentWeek: n,
            planPct: pts,
            actualPct: pts.map(() => null),
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={forceMonotonic}>
            <TrendingUp aria-hidden className="size-3.5" />
            Paksa naik
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={scaleTo100}>
            <SlidersHorizontal aria-hidden className="size-3.5" />
            Skala ke 100%
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={!dirty}>
            <RotateCcw aria-hidden className="size-3.5" />
            Reset
          </Button>
        </div>
        {invalid ? (
          <Banner tone="warning" title={invalid} className="mt-3" />
        ) : (
          <p className="mt-3 text-xs text-ink-muted">
            Kurva valid: monoton naik, mulai 0%, berakhir 100%. Simpan membuat
            baseline manual baru (baseline lama tetap tersimpan sebagai histori).
          </p>
        )}
        <form action={action} className="mt-3">
          <input type="hidden" name="baselineId" value={baselineId} />
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="points" value={JSON.stringify(pts)} />
          <Button type="submit" size="sm" loading={pending} disabled={!!invalid || !dirty}>
            Simpan kurva manual
          </Button>
          {state?.error ? <Banner tone="error" title={state.error} className="mt-2" /> : null}
          {state?.success ? <Banner tone="success" title={state.success} className="mt-2" /> : null}
        </form>
      </div>

      {/* Tabel edit per minggu */}
      <div className="max-h-96 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-1.5">Minggu</th>
              <th className="px-3 py-1.5 text-right">Rencana kumulatif (%)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pts.map((p, i) => {
              const below = i > 0 && p < pts[i - 1] - 1e-9;
              return (
                <tr key={i}>
                  <td className="tabular px-3 py-1">{i + 1}</td>
                  <td className="px-3 py-1 text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min={0}
                      max={100}
                      value={Number.isFinite(p) ? p : ""}
                      invalid={below || p < 0 || p > 100}
                      onChange={(e) => setAt(i, e.target.value === "" ? NaN : Number(e.target.value))}
                      className="h-8 w-24 text-right"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
