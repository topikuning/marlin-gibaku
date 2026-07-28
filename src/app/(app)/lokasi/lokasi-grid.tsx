"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { MarlinGrid, pctCol, rupiahCol } from "@/components/grid/marlin-grid";
import { StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import type { LocationStatus } from "@/generated/prisma/enums";

export type LokasiRow = {
  id: string;
  slug: string;
  name: string;
  wilayah: string;
  paket: string;
  status: LocationStatus;
  planPct: number;
  realizedPct: number;
  deviationPct: number;
  /** Nilai RAB pra-PPN (rupiah, Number — hanya display). */
  rabValue: number;
};

const COLUMN_DEFS: ColDef<LokasiRow>[] = [
  {
    field: "name",
    headerName: "Lokasi",
    minWidth: 200,
    flex: 1,
    cellRenderer: (p: ICellRendererParams<LokasiRow>) =>
      p.data ? (
        <Link href={`/lokasi/${p.data.slug}`} className="font-medium text-primary hover:underline">
          {p.data.name}
        </Link>
      ) : null,
  },
  { field: "paket", headerName: "Paket", minWidth: 180, flex: 1 },
  { field: "wilayah", headerName: "Wilayah", minWidth: 160 },
  {
    field: "status",
    headerName: "Status",
    width: 130,
    cellRenderer: (p: ICellRendererParams<LokasiRow>) =>
      p.data ? (
        <StatusPill tone={LOCATION_STATUS_TONE[p.data.status]} label={LOCATION_STATUS_LABEL[p.data.status]} />
      ) : null,
    valueFormatter: (p) => (p.value ? LOCATION_STATUS_LABEL[p.value as LocationStatus] : ""),
  },
  pctCol<LokasiRow>("planPct", "Rencana", { width: 110 }),
  pctCol<LokasiRow>("realizedPct", "Dilaporkan", { width: 110 }),
  {
    field: "deviationPct",
    headerName: "Deviasi",
    width: 110,
    cellRenderer: (p: ICellRendererParams<LokasiRow>) =>
      p.data ? <DeltaBadge value={p.data.deviationPct} /> : null,
    cellClass: "text-right",
    headerClass: "ag-right-aligned-header",
  },
  rupiahCol<LokasiRow>("rabValue", "Nilai RAB", { width: 160 }),
];

export function LokasiGrid({ rows }: { rows: LokasiRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LocationStatus | "semua">("semua");
  const mobileRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id-ID");
    return rows.filter((row) => {
      const matchesQuery = !normalized || `${row.name} ${row.wilayah} ${row.paket}`.toLocaleLowerCase("id-ID").includes(normalized);
      return matchesQuery && (status === "semua" || row.status === status);
    });
  }, [query, rows, status]);

  return (
    <>
      <div className="hidden md:block">
        <MarlinGrid<LokasiRow>
          rowData={rows}
          columnDefs={COLUMN_DEFS}
          quickFilter
          csvExport
          persistKey="lokasi-list"
          getRowId={(r) => r.id}
          emptyText="Belum ada lokasi yang bisa diakses."
        />
      </div>

      <div className="space-y-3 md:hidden">
        <div className="rounded-lg border border-border bg-surface p-3">
          <label className="relative block">
            <span className="sr-only">Cari lokasi</span>
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari lokasi, wilayah, atau paket…"
              className="h-11 w-full rounded-md border border-border bg-surface-muted pl-9 pr-3 text-base text-ink"
            />
          </label>
          <label className="mt-2 block">
            <span className="sr-only">Filter status lokasi</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as LocationStatus | "semua")}
              className="h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-ink"
            >
              <option value="semua">Semua status</option>
              {Object.entries(LOCATION_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <p className="px-1 text-xs font-medium text-ink-muted">{mobileRows.length} lokasi sesuai filter</p>
        {mobileRows.map((row) => (
          <Link
            key={row.id}
            href={`/lokasi/${row.slug}`}
            className="block rounded-lg border border-border bg-surface p-4 active:bg-surface-muted"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block text-sm text-ink">{row.name}</strong>
                <span className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                  <MapPin aria-hidden className="size-3.5" /> {row.wilayah}
                </span>
              </div>
              <StatusPill tone={LOCATION_STATUS_TONE[row.status]} label={LOCATION_STATUS_LABEL[row.status]} />
            </div>
            <p className="mt-3 truncate border-t border-border pt-3 text-xs text-ink-muted">{row.paket}</p>
            <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
              <div className="bg-surface-muted px-2 py-2">
                <dt className="text-[11px] text-ink-muted">Rencana</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{row.planPct.toFixed(1)}%</dd>
              </div>
              <div className="bg-surface-muted px-2 py-2">
                <dt className="text-[11px] text-ink-muted">Dilaporkan</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{row.realizedPct.toFixed(1)}%</dd>
              </div>
              <div className="bg-surface-muted px-2 py-2">
                <dt className="text-[11px] text-ink-muted">Deviasi</dt>
                <dd className="mt-0.5"><DeltaBadge value={row.deviationPct} /></dd>
              </div>
            </dl>
            <span className="mt-3 flex items-center justify-end gap-1 text-xs font-semibold text-primary">
              Buka workspace <ArrowRight aria-hidden className="size-3.5" />
            </span>
          </Link>
        ))}
        {mobileRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
            Tidak ada lokasi yang cocok dengan filter.
          </div>
        ) : null}
      </div>
    </>
  );
}
