import type { ColDef, ColDefField, ValueFormatterParams } from "ag-grid-community";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";

/**
 * Pabrik kolom MarlinGrid — formatter konsisten dari `@/lib/format`.
 *
 * Terpisah dari `marlin-grid.tsx` supaya susunan kolom sebuah layar bisa
 * DIUJI tanpa memuat AG Grid: berkas komponennya mendaftarkan modul AG Grid dan
 * menarik `ag-grid-react` saat diimpor, dan itu tidak bisa dijalankan di uji
 * unit yang berlingkungan node. Yang di sini murni data.
 *
 * `marlin-grid.tsx` mengekspor ulang ketiganya, jadi pemanggil lama tidak
 * perlu tahu perpindahan ini.
 */

const NUMERIC_CELL = "tabular text-right";

/** Kolom Rupiah (BigInt/number), rata kanan + tabular. */
export function rupiahCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatRupiah(p.value as bigint | number),
    cellClass: NUMERIC_CELL,
    headerClass: "ag-right-aligned-header",
    ...extra,
  };
}

/** Kolom persen, rata kanan + tabular. */
export function pctCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatPct(Number(p.value)),
    cellClass: NUMERIC_CELL,
    headerClass: "ag-right-aligned-header",
    ...extra,
  };
}

/** Kolom tanggal (Date | string ISO), format Asia/Jakarta. */
export function dateCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatTanggal(new Date(p.value as string | Date)),
    cellClass: "tabular",
    ...extra,
  };
}
