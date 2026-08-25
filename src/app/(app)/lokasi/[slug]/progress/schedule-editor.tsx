"use client";

import { useActionState, useMemo, useState } from "react";
import { CalendarRange, Plus, RotateCcw, X } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import {
  cumulativeFromWeeklyRows,
  weeklyFromSegments,
  type WeekSegment,
} from "@/lib/scurve/generate";
import type { CategoryScheduleView } from "@/lib/baseline";
import { saveCategoryScheduleAction, type RabActionState } from "../rab/actions";

type Row = { lineageKey: string; name: string; weightPct: number; segments: WeekSegment[] };

const cloneRows = (rows: CategoryScheduleView[]): Row[] =>
  rows.map((r) => ({
    lineageKey: r.lineageKey,
    name: r.name,
    weightPct: r.weightPct,
    segments: r.segments.map((s) => ({ ...s })),
  }));

const sameSegments = (a: WeekSegment[], b: WeekSegment[] | undefined): boolean =>
  !!b && a.length === b.length && a.every((s, i) => s.startWeek === b[i].startWeek && s.endWeek === b[i].endWeek);

/**
 * Editor jadwal per pekerjaan (kategori RAB) — format standar kurva-S sipil:
 * bobot % TERKUNCI (derived dari nilai RAB). Yang diatur user = RENTANG minggu
 * per pekerjaan; sebuah pekerjaan boleh punya BEBERAPA rentang (minggu TERPUTUS
 * / jeda — mis. mobilisasi awal + demobilisasi akhir, atau tahap bertahap).
 * Bobot disebar lonceng per rentang; kurva = akumulasi mingguan. DECISIONS 103.
 */
export function ScheduleEditor({
  locationId,
  totalWeeks,
  origin,
  initial,
}: {
  locationId: string;
  totalWeeks: number;
  origin: "tersimpan" | "otomatis";
  initial: CategoryScheduleView[];
}) {
  const [rows, setRows] = useState<Row[]>(() => cloneRows(initial));
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    saveCategoryScheduleAction,
    undefined,
  );

  const mutateSegments = (i: number, fn: (segs: WeekSegment[]) => WeekSegment[]) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, segments: fn(r.segments) } : r)));

  const setSeg = (i: number, j: number, field: "startWeek" | "endWeek", v: number) =>
    mutateSegments(i, (segs) => segs.map((s, k) => (k === j ? { ...s, [field]: v } : s)));

  const addSeg = (i: number) =>
    mutateSegments(i, (segs) => {
      const lastEnd = segs.reduce((m, s) => Math.max(m, s.endWeek), 0);
      const start = Math.min(totalWeeks, Math.max(1, lastEnd + 2)); // sisakan 1 minggu jeda
      return [...segs, { startWeek: start, endWeek: Math.min(totalWeeks, start) }];
    });

  const removeSeg = (i: number, j: number) =>
    mutateSegments(i, (segs) => (segs.length <= 1 ? segs : segs.filter((_, k) => k !== j)));

  const dirty = useMemo(
    () => rows.some((r, i) => !sameSegments(r.segments, initial[i]?.segments)),
    [rows, initial],
  );

  const invalid = useMemo(() => {
    for (const r of rows) {
      if (r.segments.length === 0) return `"${r.name}": minimal satu rentang minggu.`;
      const sorted = [...r.segments].sort((a, b) => a.startWeek - b.startWeek);
      let prevEnd = 0;
      for (const s of sorted) {
        if (!Number.isInteger(s.startWeek) || !Number.isInteger(s.endWeek)) {
          return `"${r.name}": minggu harus bilangan bulat.`;
        }
        if (s.startWeek < 1 || s.endWeek > totalWeeks) {
          return `"${r.name}": minggu harus dalam rentang 1–${totalWeeks}.`;
        }
        if (s.startWeek > s.endWeek) {
          return `"${r.name}": rentang ${s.startWeek}–${s.endWeek} terbalik.`;
        }
        if (s.startWeek <= prevEnd) {
          return `"${r.name}": rentang minggu bertumpang tindih (mgg ${s.startWeek}).`;
        }
        prevEnd = s.endWeek;
      }
    }
    return null;
  }, [rows, totalWeeks]);

  const preview = useMemo(
    () =>
      invalid
        ? null
        : cumulativeFromWeeklyRows(
            rows.map((r) => weeklyFromSegments(r.weightPct, r.segments, totalWeeks)),
            totalWeeks,
          ),
    [rows, totalWeeks, invalid],
  );
  const totalWeight = useMemo(() => rows.reduce((s, r) => s + r.weightPct, 0), [rows]);

  const reset = () => setRows(cloneRows(initial));

  return (
    <div className="space-y-4">
      {origin === "otomatis" ? (
        <p className="text-xs text-ink-muted">
          Jadwal awal di bawah adalah usulan otomatis (urutan lapangan + bobot biaya).
          Sesuaikan rentang minggu tiap pekerjaan – boleh lebih dari satu rentang bila
          pekerjaan terputus – lalu simpan.
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          Menampilkan jadwal tersimpan dari baseline aktif – sesuaikan lalu simpan sebagai versi baru.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-160 text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-1.5">Pekerjaan</th>
              <th className="px-3 py-1.5 text-right">Bobot</th>
              <th className="px-3 py-1.5">Rentang minggu (boleh &gt;1 = ada jeda)</th>
              <th className="w-2/5 px-3 py-1.5">Jadwal (mgg 1–{totalWeeks})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.lineageKey}>
                <td className="max-w-56 truncate px-3 py-1.5 align-top" title={r.name}>
                  {r.name}
                </td>
                <td className="tabular px-3 py-1.5 text-right align-top text-ink-muted">
                  {r.weightPct.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%
                </td>
                <td className="px-3 py-1.5 align-top">
                  <div className="space-y-1.5">
                    {r.segments.map((s, j) => {
                      const segInvalid =
                        !Number.isInteger(s.startWeek) ||
                        !Number.isInteger(s.endWeek) ||
                        s.startWeek < 1 ||
                        s.endWeek > totalWeeks ||
                        s.startWeek > s.endWeek;
                      return (
                        <div key={j} className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={totalWeeks}
                            step={1}
                            value={Number.isFinite(s.startWeek) ? s.startWeek : ""}
                            invalid={segInvalid}
                            onChange={(e) =>
                              setSeg(i, j, "startWeek", e.target.value === "" ? NaN : Number(e.target.value))
                            }
                            className="h-8 w-16 text-right"
                            aria-label={`Minggu mulai rentang ${j + 1} ${r.name}`}
                          />
                          <span className="text-ink-muted">–</span>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={totalWeeks}
                            step={1}
                            value={Number.isFinite(s.endWeek) ? s.endWeek : ""}
                            invalid={segInvalid}
                            onChange={(e) =>
                              setSeg(i, j, "endWeek", e.target.value === "" ? NaN : Number(e.target.value))
                            }
                            className="h-8 w-16 text-right"
                            aria-label={`Minggu selesai rentang ${j + 1} ${r.name}`}
                          />
                          <button
                            type="button"
                            onClick={() => removeSeg(i, j)}
                            disabled={r.segments.length <= 1}
                            className="rounded p-1 text-ink-muted hover:bg-surface-inset disabled:opacity-30"
                            aria-label={`Hapus rentang ${j + 1} ${r.name}`}
                            title="Hapus rentang"
                          >
                            <X aria-hidden className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addSeg(i)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                    >
                      <Plus aria-hidden className="size-3" />
                      Tambah rentang
                    </button>
                  </div>
                </td>
                <td className="px-3 py-1.5 align-top">
                  <div className="relative mt-1 h-4 w-full overflow-hidden rounded bg-surface-inset">
                    {r.segments.map((s, j) => {
                      const bad = s.startWeek < 1 || s.endWeek > totalWeeks || s.startWeek > s.endWeek;
                      if (bad) return null;
                      const left = ((s.startWeek - 1) / totalWeeks) * 100;
                      const width = ((s.endWeek - s.startWeek + 1) / totalWeeks) * 100;
                      return (
                        <div
                          key={j}
                          className="absolute inset-y-0 rounded bg-primary/70"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`Mgg ${s.startWeek}–${s.endWeek}`}
                        />
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-xs text-ink-muted">
              <td className="px-3 py-1.5 font-medium">Total bobot</td>
              <td className="tabular px-3 py-1.5 text-right font-medium">
                {totalWeight.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%
              </td>
              <td colSpan={2} className="px-3 py-1.5">
                Bobot mengikuti nilai RAB (tidak bisa diubah di sini – ubah lewat revisi RAB/adendum).
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {preview ? (
            <ScurveChart
              series={{
                totalWeeks,
                currentWeek: totalWeeks,
                planPct: preview,
                actualPct: preview.map(() => null),
              }}
            />
          ) : null}
          {invalid ? (
            <Banner tone="warning" title={invalid} className="mt-3" />
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              Pratinjau kurva dari jadwal di atas – bobot tiap pekerjaan disebar lonceng
              per rentang (0 di minggu jeda), lalu diakumulasi.
            </p>
          )}
        </div>
        <div className="flex flex-col items-start justify-end gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={!dirty}>
              <RotateCcw aria-hidden className="size-3.5" />
              Reset
            </Button>
          </div>
          <form action={action}>
            <input type="hidden" name="locationId" value={locationId} />
            <input
              type="hidden"
              name="rows"
              value={JSON.stringify(
                rows.map((r) => ({ lineageKey: r.lineageKey, segments: r.segments })),
              )}
            />
            <Button type="submit" size="sm" loading={pending} disabled={!!invalid || !dirty}>
              <CalendarRange aria-hidden className="size-3.5" />
              Simpan jadwal (baseline baru)
            </Button>
          </form>
          {state?.error ? <Banner tone="error" title={state.error} /> : null}
          {state?.success ? <Banner tone="success" title={state.success} /> : null}
        </div>
      </div>
    </div>
  );
}
