"use client";

import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { MarlinGrid } from "@/components/grid/marlin-grid";
import { StatusPill, type BadgeTone } from "@/components/ui";

/** Satu baris portofolio Kawal – semua angka & label sudah disusun di server. */
export type BarisKawal = {
  slug: string;
  lokasi: string;
  paket: string;
  kabupaten: string;
  marlin: string;
  kawal: string;
  selisih: string;
  /** |selisih| untuk mengurutkan; -1 = tidak dinilai. */
  urutSelisih: number;
  arah: string;
  tingkat: string;
  tone: BadgeTone;
  minggu: string;
  kontraktor: string;
};

function kolom(): ColDef<BarisKawal>[] {
  return [
    {
      field: "lokasi",
      headerName: "Lokasi",
      pinned: "left",
      minWidth: 170,
      flex: 2,
      cellRenderer: (p: ICellRendererParams<BarisKawal>) =>
        p.data ? (
          <Link
            href={`/lokasi/${p.data.slug}/kawal`}
            prefetch={false}
            className="block py-1.5 font-medium text-primary hover:underline"
          >
            {p.data.lokasi}
          </Link>
        ) : null,
    },
    { field: "paket", headerName: "Paket", minWidth: 150, flex: 1 },
    { field: "marlin", headerName: "MARLIN", minWidth: 100, flex: 1, type: "numericColumn" },
    { field: "kawal", headerName: "Kawal", minWidth: 100, flex: 1, type: "numericColumn" },
    {
      field: "urutSelisih",
      headerName: "Selisih",
      minWidth: 250,
      flex: 2,
      sort: "desc",
      cellRenderer: (p: ICellRendererParams<BarisKawal>) =>
        p.data ? (
          <span className="flex items-center gap-2">
            <span className="tabular">{p.data.selisih}</span>
            <StatusPill tone={p.data.tone} label={p.data.arah || p.data.tingkat} />
          </span>
        ) : null,
    },
    { field: "minggu", headerName: "Minggu Kawal", minWidth: 170, flex: 1 },
    {
      field: "kontraktor",
      headerName: "Isian kontraktor",
      headerTooltip: "Progres yang diisi kontraktor sendiri di Kawal (progres_pelaksana)",
      minWidth: 165,
      flex: 1,
      type: "numericColumn",
    },
  ];
}

export function PerbandinganGrid({ rows }: { rows: BarisKawal[] }) {
  return (
    <MarlinGrid<BarisKawal>
      rowData={rows}
      columnDefs={kolom()}
      getRowId={(d) => d.slug}
      quickFilter
      csvExport
      pageSize={100}
      emptyText="Belum ada lokasi yang berpasangan dengan Kawal."
    />
  );
}
