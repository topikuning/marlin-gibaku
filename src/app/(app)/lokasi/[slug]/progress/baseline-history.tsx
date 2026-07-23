"use client";

import { useActionState, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Banner, Button, StatusPill, type BadgeTone } from "@/components/ui";
import { formatPct } from "@/lib/format";
import { restoreBaselineAction, type RabActionState } from "../rab/actions";

export type BaselineHistoryRow = {
  id: string;
  baselineNo: number;
  sourceLabel: string;
  statusLabel: string;
  statusTone: BadgeTone;
  isActive: boolean;
  contractDays: number;
  note: string | null;
  createdAtLabel: string;
  points: number[];
};

const COMPARE_COLORS = [
  "var(--color-primary)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-ink-faint)",
];
const MAX_COMPARE = COMPARE_COLORS.length;

/** Overlay beberapa versi baseline pada satu grafik (sumbu minggu disamakan). */
function CompareChart({ series }: { series: { label: string; points: number[]; color: string }[] }) {
  const W = 640;
  const H = 260;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, ...series.map((s) => s.points.length));

  const xFor = (i: number) => padL + (i / n) * plotW;
  const yFor = (pct: number) => padT + (1 - Math.min(Math.max(pct, 0), 100) / 100) * plotH;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Perbandingan versi baseline">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={yFor(g)} x2={W - padR} y2={yFor(g)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={padL - 6} y={yFor(g) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
              {g}%
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline
            key={s.label}
            points={[0, ...s.points].map((p, i) => `${xFor(i)},${yFor(p)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
          />
        ))}
        {[0, Math.round(n / 2), n].map((i) => (
          <text
            key={i}
            x={xFor(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === n ? "end" : "middle"}
            fontSize={10}
            fill="var(--color-ink-faint)"
          >
            {i === 0 ? "mulai" : `mgg ${i}`}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-ink">
            <span aria-hidden className="inline-block h-0.5 w-5" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RestoreButton({ baselineId, baselineNo }: { baselineId: string; baselineNo: number }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    restoreBaselineAction,
    undefined,
  );
  const [confirm, setConfirm] = useState(false);

  if (!confirm) {
    return (
      <div className="space-y-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(true)}>
          <History aria-hidden className="size-3.5" />
          Pulihkan
        </Button>
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-md border border-border bg-surface-muted p-2">
      <p className="text-[12px] text-ink">
        Aktifkan kembali kurva versi #{baselineNo}? Dibuat sebagai versi BARU
        (salinan), baseline aktif sekarang digantikan — riwayat tetap utuh.
      </p>
      <input type="hidden" name="baselineId" value={baselineId} />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Ya, pulihkan
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
          Batal
        </Button>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
    </form>
  );
}

/** Riwayat baseline: tabel versi + centang "Bandingkan" (overlay grafik) + Pulihkan. */
export function BaselineHistory({
  baselines,
  canManage,
}: {
  baselines: BaselineHistoryRow[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    baselines.filter((b) => b.isActive).map((b) => b.id),
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id],
    );

  const compareSeries = useMemo(() => {
    const chosen = baselines.filter((b) => selected.includes(b.id) && b.points.length > 0);
    return chosen.map((b, i) => ({
      label: `#${b.baselineNo}${b.isActive ? " (aktif)" : ""}`,
      points: b.points,
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
    }));
  }, [baselines, selected]);

  if (baselines.length === 0) {
    return <p className="text-sm text-ink-muted">Belum ada baseline.</p>;
  }

  return (
    <div className="space-y-4">
      {compareSeries.length > 0 ? (
        <CompareChart series={compareSeries} />
      ) : (
        <p className="text-xs text-ink-muted">Centang versi di tabel untuk membandingkan kurvanya.</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="py-2 pr-3">Banding</th>
              <th className="py-2 pr-3">Versi</th>
              <th className="py-2 pr-3">Sumber</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Durasi</th>
              <th className="py-2 pr-3">Tanggal</th>
              <th className="py-2 pr-3">Catatan</th>
              <th className="py-2">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {baselines.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(b.id)}
                    onChange={() => toggle(b.id)}
                    disabled={!selected.includes(b.id) && selected.length >= MAX_COMPARE}
                    aria-label={`Bandingkan baseline #${b.baselineNo}`}
                    className="size-4 accent-(--color-primary)"
                  />
                </td>
                <td className="tabular py-2 pr-3">#{b.baselineNo}</td>
                <td className="py-2 pr-3">{b.sourceLabel}</td>
                <td className="py-2 pr-3">
                  <StatusPill tone={b.statusTone} label={b.statusLabel} />
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {b.contractDays} hari ({b.points.length} mgg)
                </td>
                <td className="tabular py-2 pr-3">{b.createdAtLabel}</td>
                <td className="max-w-60 truncate py-2 pr-3 text-ink-muted" title={b.note ?? undefined}>
                  {b.note ?? "—"}
                </td>
                <td className="py-2">
                  <div className="space-y-1">
                    <details>
                      <summary className="cursor-pointer text-[13px] text-primary hover:underline">
                        Lihat angka
                      </summary>
                      <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-surface-muted p-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-ink-muted">
                              <th className="py-0.5 pr-2">Mgg</th>
                              <th className="py-0.5 text-right">Rencana kumulatif</th>
                            </tr>
                          </thead>
                          <tbody>
                            {b.points.map((p, i) => (
                              <tr key={i}>
                                <td className="tabular py-0.5 pr-2">{i + 1}</td>
                                <td className="tabular py-0.5 text-right">{formatPct(p)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    {canManage && !b.isActive && b.points.length > 0 ? (
                      <RestoreButton baselineId={b.id} baselineNo={b.baselineNo} />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
