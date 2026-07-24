"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { Banner, Button, HelpText, Input, Label, Select, Textarea } from "@/components/ui";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import {
  addWeeklyPlanItem,
  applyWeeklySuggestions,
  getWeeklySuggestions,
  removeWeeklyPlanItem,
  type RabActionState,
  type SuggestState,
} from "./actions";

export type PlanItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  targetVolume: number;
  priority: number;
  picName: string | null;
  note: string | null;
  /** Σ volume laporan counted pada minggu terpilih. */
  realizedVolume: number;
};

export type LeafOption = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
};

const MAX_OPTIONS = 100;

function RemoveButton({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    removeWeeklyPlanItem,
    undefined,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="itemId" value={itemId} />
      <Button size="sm" variant="ghost" type="submit" loading={pending} title="Hapus dari rencana">
        Hapus
      </Button>
      {state?.error ? <span className="ml-1 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function AddItemForm({
  locationId,
  weekNumber,
  options,
}: {
  locationId: string;
  weekNumber: number;
  options: LeafOption[];
}) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    addWeeklyPlanItem,
    undefined,
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      : options;
    return hit.slice(0, MAX_OPTIONS);
  }, [query, options]);

  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="weekNumber" value={weekNumber} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="wp-search">Cari item pekerjaan (leaf RAB)</Label>
          <Input
            id="wp-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="mis. galian, bekisting, K3…"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="wp-item" required>Item pekerjaan</Label>
          <Select id="wp-item" name="rabNodeId" required key={query /* reset pilihan saat filter berubah */}>
            <option value="">— pilih item ({filtered.length}{filtered.length === MAX_OPTIONS ? "+" : ""} tersedia) —</option>
            {filtered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
                {o.volume != null ? ` (vol RAB ${formatNumber(o.volume)} ${o.unit ?? ""})` : ""}
              </option>
            ))}
          </Select>
          {filtered.length === MAX_OPTIONS ? (
            <HelpText>Menampilkan {MAX_OPTIONS} pertama — persempit lewat pencarian.</HelpText>
          ) : null}
        </div>
        <div>
          <Label htmlFor="wp-target" required>Target volume</Label>
          <Input id="wp-target" name="targetVolume" type="number" step="0.001" min="0.001" required />
        </div>
        <div>
          <Label htmlFor="wp-priority">Prioritas (1 = tertinggi)</Label>
          <Select id="wp-priority" name="priority" defaultValue="5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="wp-pic">PIC</Label>
          <Input id="wp-pic" name="picName" maxLength={120} placeholder="Nama penanggung jawab" />
        </div>
        <div>
          <Label htmlFor="wp-note">Catatan</Label>
          <Textarea id="wp-note" name="note" rows={1} maxLength={500} />
        </div>
      </div>
      <Button type="submit" loading={pending}>Tambah ke rencana</Button>
    </form>
  );
}

function SuggestPanel({ locationId, weekNumber }: { locationId: string; weekNumber: number }) {
  const [sugState, suggest, suggesting] = useActionState<SuggestState, FormData>(
    getWeeklySuggestions,
    undefined,
  );
  const [applyState, apply, applying] = useActionState<RabActionState, FormData>(
    applyWeeklySuggestions,
    undefined,
  );
  const result = sugState?.result;

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Saran otomatis minggu {weekNumber}</p>
          <p className="text-xs text-ink-muted">
            Berdasar urutan pekerjaan lapangan + realisasi. Bila tertinggal, saran mengejar deviasi.
          </p>
        </div>
        <form action={suggest}>
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="weekNumber" value={weekNumber} />
          <Button type="submit" variant="secondary" size="sm" loading={suggesting}>
            {result ? "Muat ulang saran" : "Sarankan otomatis"}
          </Button>
        </form>
      </div>

      {sugState?.error ? <Banner tone="info" title={sugState.error} /> : null}
      {applyState?.error ? <Banner tone="error" title={applyState.error} /> : null}
      {applyState?.success ? <Banner tone="success" title={applyState.success} /> : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-ink-muted">
              Rencana s/d minggu berjalan: <span className="font-semibold text-ink">{formatPct(result.planPct)}</span>
            </span>
            <span className="text-ink-muted">
              Realisasi: <span className="font-semibold text-ink">{formatPct(result.actualPct)}</span>
            </span>
            <span className={result.behind ? "font-semibold text-danger" : "font-semibold text-success"}>
              Deviasi {result.deviationPct > 0 ? "+" : ""}
              {formatPct(result.deviationPct)} {result.behind ? "(tertinggal)" : "(aman)"}
            </span>
          </div>

          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-1.5 pr-3 pl-2">Uraian</th>
                  <th className="py-1.5 pr-3">Trade</th>
                  <th className="py-1.5 pr-3 text-right">Sisa</th>
                  <th className="py-1.5 pr-3 text-right">Target mgg ini</th>
                  <th className="py-1.5 pr-3 text-right">Nilai</th>
                  <th className="py-1.5 pr-3">Prioritas</th>
                  <th className="py-1.5 pr-3">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.suggestions.map((s) => (
                  <tr key={s.rabNodeId}>
                    <td className="max-w-64 truncate py-1.5 pr-3 pl-2" title={s.name}>
                      <span className="text-xs text-ink-muted">{s.code}</span> {s.name}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-ink-muted">{s.stageLabel}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-ink-muted">
                      {formatNumber(s.remainingVolume)} {s.unit ?? ""}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right font-semibold">
                      {formatNumber(s.targetVolume)} {s.unit ?? ""}
                      {s.catchUpVolume > 0 ? (
                        <span className="ml-1 text-[11px] text-danger">
                          (+{formatNumber(s.catchUpVolume)} kejar)
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right text-ink-muted">{formatRupiah(s.valueTarget)}</td>
                    <td className="tabular py-1.5 pr-3">{s.priority}</td>
                    <td className="py-1.5 pr-3 text-xs text-ink-muted">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={apply}>
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="weekNumber" value={weekNumber} />
            <Button type="submit" loading={applying}>
              Terapkan {result.suggestions.length} saran ke rencana minggu {weekNumber}
            </Button>
            <HelpText>Item dimasukkan ke rencana; kamu tetap bisa mengubah target, PIC, atau menghapusnya.</HelpText>
          </form>
        </>
      ) : null}
    </div>
  );
}

export function WeeklyPlanSection({
  locationId,
  weekNumber,
  currentWeek,
  totalWeeks,
  weekPeriod,
  items,
  options,
  canManage,
}: {
  locationId: string;
  weekNumber: number;
  currentWeek: number;
  totalWeeks: number;
  weekPeriod: string | null;
  items: PlanItemRow[];
  options: LeafOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const weeks = Array.from({ length: Math.max(totalWeeks, currentWeek, weekNumber) }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wp-week">Minggu</Label>
          <Select
            id="wp-week"
            value={weekNumber}
            onChange={(e) => router.push(`${pathname}?minggu=${e.target.value}`)}
            className="w-44"
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Minggu {w}
                {w === currentWeek ? " (berjalan)" : ""}
              </option>
            ))}
          </Select>
        </div>
        {weekPeriod ? <p className="pb-2 text-[13px] text-ink-muted">{weekPeriod}</p> : null}
      </div>

      {canManage ? (
        <>
          <SuggestPanel locationId={locationId} weekNumber={weekNumber} />
          <AddItemForm locationId={locationId} weekNumber={weekNumber} options={options} />
        </>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada item rencana untuk minggu {weekNumber}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                <th className="py-2 pr-3">Kode</th>
                <th className="py-2 pr-3">Uraian</th>
                <th className="py-2 pr-3 text-right">Target</th>
                <th className="py-2 pr-3 text-right">Realisasi mgg ini</th>
                <th className="py-2 pr-3 text-right">Capaian</th>
                <th className="py-2 pr-3">Prioritas</th>
                <th className="py-2 pr-3">PIC</th>
                <th className="py-2 pr-3">Catatan</th>
                {canManage ? <th className="py-2 text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                const achievedPct = it.targetVolume > 0 ? (it.realizedVolume / it.targetVolume) * 100 : 0;
                return (
                  <tr key={it.id}>
                    <td className="py-2 pr-3 text-xs text-ink-muted">{it.code}</td>
                    <td className="max-w-72 truncate py-2 pr-3" title={it.name}>{it.name}</td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatNumber(it.targetVolume)} {it.unit ?? ""}
                    </td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatNumber(it.realizedVolume)} {it.unit ?? ""}
                    </td>
                    <td
                      className={
                        "tabular py-2 pr-3 text-right " +
                        (achievedPct >= 100 ? "text-success" : achievedPct > 0 ? "text-warning" : "text-ink-muted")
                      }
                    >
                      {formatPct(achievedPct, 0)}
                    </td>
                    <td className="tabular py-2 pr-3">{it.priority}</td>
                    <td className="py-2 pr-3 text-ink-muted">{it.picName ?? "—"}</td>
                    <td className="max-w-52 truncate py-2 pr-3 text-ink-muted" title={it.note ?? undefined}>
                      {it.note ?? "—"}
                    </td>
                    {canManage ? (
                      <td className="py-2 text-right">
                        <RemoveButton itemId={it.id} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
