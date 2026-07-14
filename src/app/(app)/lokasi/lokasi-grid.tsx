"use client";

import Link from "next/link";
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
  pctCol<LokasiRow>("realizedPct", "Realisasi", { width: 110 }),
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
  return (
    <MarlinGrid<LokasiRow>
      rowData={rows}
      columnDefs={COLUMN_DEFS}
      quickFilter
      csvExport
      persistKey="lokasi-list"
      getRowId={(r) => r.id}
      emptyText="Belum ada lokasi yang bisa diakses."
    />
  );
}
