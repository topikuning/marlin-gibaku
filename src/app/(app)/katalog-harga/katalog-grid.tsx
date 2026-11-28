"use client";

import { useMemo } from "react";
import type { ColDef, ICellRendererParams, ValueFormatterParams } from "ag-grid-community";
import { MarlinGrid } from "@/components/grid/marlin-grid";
import { rupiahCol } from "@/components/grid/kolom";

/** Satu baris katalog harga wilayah – BigInt sudah jadi angka/teks di server. */
export type BarisKatalog = {
  id: string;
  wilayah: string;
  kategori: string;
  nama: string;
  satuan: string;
  harga: number;
  rentang: string;
  metode: string;
  keyakinan: string;
  alasan: string;
  sumber: { url: string; judul: string; domain: string }[];
  diperbarui: string;
};

const LABEL_METODE: Record<string, string> = { web: "Web (bersumber)", ai: "Estimasi AI" };

export function KatalogGrid({ rows, tampilWilayah }: { rows: BarisKatalog[]; tampilWilayah: boolean }) {
  // Urutan: yang dibutuhkan untuk menilai sebuah harga (harga, dasarnya,
  // sumbernya) di layar pertama; Kabupaten hanya bila lebih dari satu wilayah.
  const kolom = useMemo<ColDef<BarisKatalog>[]>(
    () => [
      { field: "nama", headerName: "Sumber daya", minWidth: 200, flex: 2, filter: true, tooltipField: "nama" },
      { field: "satuan", headerName: "Satuan", width: 80 },
      { ...rupiahCol<BarisKatalog>("harga", "Harga"), width: 135 },
      {
        field: "metode",
        headerName: "Dasar",
        width: 140,
        filter: true,
        valueFormatter: (p: ValueFormatterParams<BarisKatalog>) => LABEL_METODE[String(p.value)] ?? String(p.value),
      },
      {
        colId: "sumber",
        headerName: "Sumber",
        minWidth: 200,
        flex: 1,
        // Alamat yang benar-benar muncul di hasil pencarian (DECISIONS 806).
        cellRenderer: (p: ICellRendererParams<BarisKatalog>) =>
          p.data && p.data.sumber.length > 0 ? (
            <span className="flex flex-wrap gap-x-2">
              {p.data.sumber.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={s.judul} className="text-primary hover:underline">
                  {s.domain}
                </a>
              ))}
            </span>
          ) : (
            <span className="text-ink-muted">–</span>
          ),
      },
      { field: "keyakinan", headerName: "Keyakinan", width: 105 },
      { field: "rentang", headerName: "Rentang", width: 190, cellClass: "text-ink-muted" },
      { field: "kategori", headerName: "Kategori", width: 100, filter: true },
      ...(tampilWilayah ? [{ field: "wilayah", headerName: "Kabupaten", minWidth: 170, filter: true } as ColDef<BarisKatalog>] : []),
      { field: "alasan", headerName: "Keterangan", minWidth: 260, flex: 2, tooltipField: "alasan", cellClass: "text-ink-muted" },
      { field: "diperbarui", headerName: "Diperbarui", width: 120 },
    ],
    [tampilWilayah],
  );
  return <MarlinGrid rowData={rows} columnDefs={kolom} getRowId={(r) => r.id} />;
}
