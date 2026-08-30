"use client";

import Link from "next/link";
import type { ColDef, ICellRendererParams, ValueFormatterParams } from "ag-grid-community";
import { MarlinGrid, pctCol, rupiahCol } from "@/components/grid/marlin-grid";
import { DeltaBadge } from "@/components/ui/stat-delta";

export type ProgressRow = {
  id: string;
  slug: string;
  name: string;
  provinsi: string;
  paket: string;
  /** "M12/24" — dirakit di server supaya grid tidak menghitung apa pun. */
  minggu: string;
  planPct: number;
  realizedPct: number;
  deviationPct: number;
  /** Nilai terpasang (rupiah, Number — hanya display). */
  terpasang: number;
  /** Tanggal kerja laporan terakhir yang DIKIRIM, "28 Agu 2026". null = belum pernah. */
  terakhirLapor: string | null;
  /** Umur tanggal itu dalam hari. null = belum pernah ada laporan terkirim. */
  terakhirLaporHari: number | null;
};

/**
 * PAPAN TAGIHAN PROGRESS — siapa yang tertinggal, dan siapa yang bahkan tidak
 * melapor.
 *
 * Dulu tabel HTML polos: tidak bisa dicari, tidak bisa disaring, tidak bisa
 * diekspor. Dengan 83 lokasi itu berarti halaman yang tugasnya MEMANTAU justru
 * satu-satunya daftar panjang di aplikasi ini yang harus dibaca dengan mata
 * telanjang, sementara direktori `/lokasi` — yang isinya lebih pendek — punya
 * semuanya. Keputusan user 2026-08-30 membalik itu.
 *
 * Identitas dikunci di kiri dengan pola yang sama seperti `/lokasi`: nama
 * lokasi dan provinsinya bertumpuk dalam satu kolom, karena tabel ini lebih
 * lebar dari satu layar dan angka progres tanpa nama pemiliknya paling mudah
 * dibaca sebagai milik lokasi yang salah.
 */
const COLUMN_DEFS: ColDef<ProgressRow>[] = [
  {
    field: "name",
    headerName: "Lokasi",
    pinned: "left",
    width: 190,
    minWidth: 160,
    cellRenderer: (p: ICellRendererParams<ProgressRow>) =>
      p.data ? (
        <Link href={`/lokasi/${p.data.slug}/progress`} className="block py-1.5 leading-tight">
          <span className="block font-medium text-primary hover:underline">{p.data.name}</span>
          <span className="block text-xs text-ink-muted">{p.data.provinsi}</span>
        </Link>
      ) : null,
  },
  { field: "paket", headerName: "Paket", minWidth: 180, flex: 1 },
  { field: "minggu", headerName: "Minggu", width: 110 },
  pctCol<ProgressRow>("planPct", "Rencana", { width: 110 }),
  pctCol<ProgressRow>("realizedPct", "Realisasi", { width: 110 }),
  {
    field: "deviationPct",
    headerName: "Deviasi",
    width: 110,
    cellRenderer: (p: ICellRendererParams<ProgressRow>) =>
      p.data ? <DeltaBadge value={p.data.deviationPct} /> : null,
    cellClass: "text-right",
    headerClass: "ag-right-aligned-header",
  },
  rupiahCol<ProgressRow>("terpasang", "Terpasang", { width: 150 }),
  {
    /*
     * Diurut dari UMURNYA, ditampilkan sebagai TANGGALNYA.
     *
     * Kolom tanggal yang diurut sebagai teks akan mengurutkan "1 Sep" sebelum
     * "28 Agu"; yang dicari pemakainya justru yang paling lama diam. Karena itu
     * medannya umur hari, dan tanggalnya ikut di keterangan bawah.
     *
     * Yang belum pernah mengirim laporan ditulis apa adanya, bukan diberi
     * angka besar supaya "kelihatan terburuk": itu akan jadi angka yang tidak
     * pernah terjadi, dan angka karangan di kolom tagihan adalah cara tercepat
     * membuat seluruh papan ini berhenti dipercaya.
     */
    field: "terakhirLaporHari",
    headerName: "Terakhir lapor",
    width: 150,
    cellRenderer: (p: ICellRendererParams<ProgressRow>) => {
      if (!p.data) return null;
      if (p.data.terakhirLaporHari === null) {
        return <span className="text-ink-muted">belum pernah</span>;
      }
      const hari = p.data.terakhirLaporHari;
      return (
        <span className="block py-1.5 leading-tight">
          <span className={hari >= 3 ? "block font-medium text-danger" : "block"}>
            {hari === 0 ? "hari ini" : `${hari} hari lalu`}
          </span>
          <span className="block text-xs text-ink-muted">{p.data.terakhirLapor}</span>
        </span>
      );
    },
    valueFormatter: (p: ValueFormatterParams<ProgressRow>) =>
      p.value == null ? "belum pernah" : `${p.value} hari lalu`,
  },
];

export function ProgressGrid({ rows }: { rows: ProgressRow[] }) {
  return (
    <MarlinGrid<ProgressRow>
      rowData={rows}
      columnDefs={COLUMN_DEFS}
      quickFilter
      csvExport
      // Sama dengan `/lokasi`: sel identitas dua baris + lajur penggulir
      // mendatar yang menumpang di dasar grid.
      rowHeight={64}
      persistKey="progress-portfolio"
      getRowId={(r) => r.id}
      rowLink
      emptyText="Belum ada lokasi aktif dalam lingkup aksesmu."
    />
  );
}
