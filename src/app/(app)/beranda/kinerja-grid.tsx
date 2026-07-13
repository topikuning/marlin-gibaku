"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/knmp/data-grid";

export type KinerjaRow = {
  id: string;
  slug: string;
  name: string;
  province: string;
  weekNumber: number;
  totalWeeks: number;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  statusLabel: string;
  statusPill: string;
  forecastLabel: string;
  forecastLate: boolean;
};

const pct = (n: number) => `${n.toFixed(1)}%`;

function Bar({ realized, plan }: { realized: number; plan: number }) {
  const r = Math.min(Math.max(realized, 0), 100);
  const p = Math.min(Math.max(plan, 0), 100);
  return (
    <div className="relative h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-[#1e3a8a]" style={{ width: `${r}%` }} />
      <div className="absolute top-0 h-full w-0.5 bg-[#DC2626]" style={{ left: `${p}%` }} title={`Rencana ${p.toFixed(1)}%`} />
    </div>
  );
}

export function KinerjaGrid({ rows }: { rows: KinerjaRow[] }) {
  const columns = useMemo<ColumnDef<KinerjaRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Proyek",
        cell: (c) => {
          const row = c.row.original;
          return (
            <div>
              <Link href={`/lokasi/${row.slug}`} className="font-medium text-slate-900 hover:text-[#1e3a8a]">{row.name}</Link>
              <div className="text-xs text-slate-500">{row.province} · minggu {row.weekNumber}/{row.totalWeeks}</div>
              <div className={`text-[11px] ${row.forecastLate ? "text-[#DC2626]" : "text-slate-400"}`}>Forecast: {row.forecastLabel}</div>
            </div>
          );
        },
      },
      {
        accessorKey: "realizedPct",
        header: "Progress",
        enableSorting: false,
        cell: (c) => <Bar realized={c.row.original.realizedPct} plan={c.row.original.planPct} />,
      },
      { accessorKey: "realizedPct", id: "realisasi", header: "Realisasi", meta: { align: "right" }, cell: (c) => <span className="font-medium tabular-nums text-slate-900">{pct(c.getValue<number>())}</span> },
      { accessorKey: "planPct", header: "Rencana", meta: { align: "right" }, cell: (c) => <span className="tabular-nums text-slate-500">{pct(c.getValue<number>())}</span> },
      {
        accessorKey: "deviationPct",
        header: "Deviasi",
        meta: { align: "right" },
        cell: (c) => {
          const d = c.getValue<number>();
          const cls = d < -1 ? "text-[#DC2626]" : d >= -1 ? "text-[#15803D]" : "text-slate-500";
          return <span className={`font-medium tabular-nums ${cls}`}>{d >= 0 ? "+" : ""}{d.toFixed(1)}%</span>;
        },
      },
      { accessorKey: "statusLabel", header: "Status", cell: (c) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.row.original.statusPill}`}>{c.getValue<string>()}</span> },
    ],
    []
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari proyek…" empty="Belum ada lokasi." />;
}
