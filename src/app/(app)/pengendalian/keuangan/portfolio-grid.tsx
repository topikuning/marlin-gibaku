"use client";

import Link from "next/link";
import { formatRupiah } from "@/lib/format";
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
            // block py-1.5: sasaran ketuk setinggi sel, bukan seutas teks 16px.
            <Link href={`/proyek/lokasi/${p.data.slug}/keuangan`} className="block py-1.5 font-medium text-primary hover:underline">
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
      // Seluruh baris membuka keuangan lokasinya — pola yang sama dengan
      // daftar lokasi & paket (DECISIONS 247).
      rowLink
      /*
       * Kartu di layar sempit. Delapan kolom rupiah berdampingan mustahil
       * dibaca di ponsel; yang dipertahankan empat yang menjawab "masih ada
       * uangnya atau tidak": pagu, realisasi, komitmen, dan sisa.
       */
      kartu={(r) => ({
        judul: r.name,
        subjudul: r.province,
        rinci: [
          { label: "Pagu", nilai: formatRupiah(BigInt(Math.round(r.budget))) },
          { label: "Realisasi", nilai: formatRupiah(BigInt(Math.round(r.realisasi))) },
          { label: "Komitmen", nilai: formatRupiah(BigInt(Math.round(r.komitmen))) },
          { label: "Sisa pagu", nilai: formatRupiah(BigInt(Math.round(r.available))) },
        ],
        href: `/proyek/lokasi/${r.slug}/keuangan`,
      })}
      emptyText="Belum ada data keuangan"
    />
  );
}
