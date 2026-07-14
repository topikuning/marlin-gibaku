"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { Banner, Button, HelpText, Input, Label, Select, Textarea } from "@/components/ui";
import { formatNumber, formatPct } from "@/lib/format";
import { addWeeklyPlanItem, removeWeeklyPlanItem, type RabActionState } from "./actions";

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
        <AddItemForm locationId={locationId} weekNumber={weekNumber} options={options} />
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
