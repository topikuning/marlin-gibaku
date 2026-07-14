"use client";

import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useMemo } from "react";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";

export type PortfolioRow = {
  locationId: string;
  name: string;
  slug: string;
  province: string;
  budget: number;
  realisasi: number;
  komitmen: number;
  available: number;
  outstanding: number;
  terpasang: number;
  unbilled: number;
};

const NUMERIC_CELL = "tabular text-right";

export function PortfolioGrid({ rows }: { rows: PortfolioRow[] }) {
  const columnDefs = useMemo<ColDef<PortfolioRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Lokasi",
        minWidth: 200,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PortfolioRow>) =>
          p.data ? (
            <Link href={`/lokasi/${p.data.slug}/keuangan`} className="font-medium text-primary hover:underline">
              {p.data.name}
            </Link>
          ) : null,
      },
      { field: "province", headerName: "Provinsi", width: 140 },
      rupiahCol<PortfolioRow>("budget", "Budget", { width: 150 }),
      rupiahCol<PortfolioRow>("realisasi", "Realisasi", { width: 150 }),
      rupiahCol<PortfolioRow>("komitmen", "Komitmen terbuka", { width: 160 }),
      rupiahCol<PortfolioRow>("available", "Available", {
        width: 150,
        cellClass: (p) => (Number(p.value) < 0 ? `${NUMERIC_CELL} font-semibold text-danger` : NUMERIC_CELL),
      }),
      rupiahCol<PortfolioRow>("outstanding", "Outstanding", { width: 150 }),
      rupiahCol<PortfolioRow>("terpasang", "Terpasang", { width: 150 }),
      rupiahCol<PortfolioRow>("unbilled", "Belum tertagih", { width: 150 }),
    ],
    [],
  );

  return (
    <MarlinGrid<PortfolioRow>
      rowData={rows}
      columnDefs={columnDefs}
      quickFilter
      csvExport
      persistKey="keuangan-portfolio"
      getRowId={(r) => r.locationId}
      emptyText="Belum ada data keuangan"
    />
  );
}
