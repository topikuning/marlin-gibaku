"use client";

import { useActionState, useMemo, useState } from "react";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { curveFromCategorySchedule } from "@/lib/scurve/generate";
import type { CategoryScheduleView } from "@/lib/baseline";
import { saveCategoryScheduleAction, type RabActionState } from "../rab/actions";

/**
 * Editor jadwal per pekerjaan (kategori RAB) — format standar kurva-S sipil:
 * bobot % TERKUNCI (derived dari nilai RAB), yang diatur user hanya JENDELA
 * minggu mulai–selesai per pekerjaan (barchart). Bobot dibagi rata per minggu
 * dalam jendela; kurva = akumulasi mingguan. Simpan = baseline baru.
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
  const [rows, setRows] = useState(() => initial.map((r) => ({ ...r })));
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    saveCategoryScheduleAction,
    undefined,
  );

  const setWeek = (i: number, field: "startWeek" | "endWeek", v: number) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: v } : r)));

  const dirty = useMemo(
    () =>
      rows.some(
        (r, i) => r.startWeek !== initial[i]?.startWeek || r.endWeek !== initial[i]?.endWeek,
      ),
    [rows, initial],
  );

  const invalid = useMemo(() => {
    for (const r of rows) {
      if (!Number.isInteger(r.startWeek) || !Number.isInteger(r.endWeek)) {
        return `"${r.name}": minggu harus bilangan bulat.`;
      }
      if (r.startWeek < 1 || r.endWeek > totalWeeks) {
        return `"${r.name}": minggu harus dalam rentang 1–${totalWeeks}.`;
      }
      if (r.startWeek > r.endWeek) {
        return `"${r.name}": minggu mulai (${r.startWeek}) melewati minggu selesai (${r.endWeek}).`;
      }
    }
    return null;
  }, [rows, totalWeeks]);

  const preview = useMemo(
    () => (invalid ? null : curveFromCategorySchedule(rows, totalWeeks)),
    [rows, totalWeeks, invalid],
  );
  const totalWeight = useMemo(() => rows.reduce((s, r) => s + r.weightPct, 0), [rows]);

  const reset = () => setRows(initial.map((r) => ({ ...r })));

  return (
    <div className="space-y-4">
      {origin === "otomatis" ? (
        <p className="text-xs text-ink-muted">
          Jadwal awal di bawah adalah usulan otomatis (urutan lapangan + bobot biaya).
          Sesuaikan minggu mulai/selesai tiap pekerjaan, lalu simpan.
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          Menampilkan jadwal tersimpan dari baseline aktif — sesuaikan lalu simpan sebagai versi baru.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-150 text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-1.5">Pekerjaan</th>
              <th className="px-3 py-1.5 text-right">Bobot</th>
              <th className="px-3 py-1.5 text-right">Mulai</th>
              <th className="px-3 py-1.5 text-right">Selesai</th>
              <th className="w-2/5 px-3 py-1.5">Jadwal (mgg 1–{totalWeeks})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const rowInvalid =
                r.startWeek < 1 || r.endWeek > totalWeeks || r.startWeek > r.endWeek;
              const left = ((r.startWeek - 1) / totalWeeks) * 100;
              const width = ((r.endWeek - r.startWeek + 1) / totalWeeks) * 100;
              return (
                <tr key={r.lineageKey}>
                  <td className="max-w-60 truncate px-3 py-1.5" title={r.name}>
                    {r.name}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-ink-muted">
                    {r.weightPct.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={totalWeeks}
                      step={1}
                      value={Number.isFinite(r.startWeek) ? r.startWeek : ""}
                      invalid={rowInvalid}
                      onChange={(e) =>
                        setWeek(i, "startWeek", e.target.value === "" ? NaN : Number(e.target.value))
                      }
                      className="h-8 w-18 text-right"
                      aria-label={`Minggu mulai ${r.name}`}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={totalWeeks}
                      step={1}
                      value={Number.isFinite(r.endWeek) ? r.endWeek : ""}
                      invalid={rowInvalid}
                      onChange={(e) =>
                        setWeek(i, "endWeek", e.target.value === "" ? NaN : Number(e.target.value))
                      }
                      className="h-8 w-18 text-right"
                      aria-label={`Minggu selesai ${r.name}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="relative h-4 w-full overflow-hidden rounded bg-surface-inset">
                      {!rowInvalid && (
                        <div
                          className="absolute inset-y-0 rounded bg-primary/70"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`Mgg ${r.startWeek}–${r.endWeek}`}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-xs text-ink-muted">
              <td className="px-3 py-1.5 font-medium">Total bobot</td>
              <td className="tabular px-3 py-1.5 text-right font-medium">
                {totalWeight.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%
              </td>
              <td colSpan={3} className="px-3 py-1.5">
                Bobot mengikuti nilai RAB (tidak bisa diubah di sini — ubah lewat revisi RAB/adendum).
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
              Pratinjau kurva dari jadwal di atas — bobot tiap pekerjaan dibagi rata
              per minggu dalam jendelanya, lalu diakumulasi.
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
                rows.map((r) => ({
                  lineageKey: r.lineageKey,
                  startWeek: r.startWeek,
                  endWeek: r.endWeek,
                })),
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
