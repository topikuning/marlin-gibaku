"use client";

import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { MarlinGrid } from "@/components/grid/marlin-grid";
import { StatusPill } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

/**
 * DAFTAR riwayat harian sebagai grid (DECISIONS 340).
 *
 * Kalender enak dipindai satu bulan; daftar ini menjawab pertanyaan yang
 * kalender tidak bisa: *"sepanjang kontrak, tanggal mana saja yang masih
 * kosong?"* — diurut, disaring, dan bisa diunduh CSV sekaligus. Itu sebabnya
 * cakupannya SELURUH rentang, bukan bulan yang sedang dibuka.
 *
 * Memakai `MarlinGrid` (AG Grid Community), bukan tabel buatan sendiri —
 * aturan CLAUDE.md, dan alasannya terasa persis di sini: 150+ baris tanpa
 * pengurutan dan pencarian bukan daftar, melainkan gulungan.
 */

export type BarisHarian = {
  dateKey: string;
  /** "Senin, 17 Agu 2026" — sudah diformat di server (satu sumber format). */
  tanggal: string;
  hari: string;
  status: string;
  tone: BadgeTone;
  itemCount: number;
  fotoCount: number;
  hariIni: boolean;
  href: string;
};

function kolom(): ColDef<BarisHarian>[] {
  return [
    {
      field: "tanggal",
      headerName: "Tanggal",
      pinned: "left",
      width: 200,
      minWidth: 160,
      cellRenderer: (p: ICellRendererParams<BarisHarian>) =>
        p.data ? (
          // Tautan mengisi tinggi sel, bukan seutas teks 16px — sasaran ketuk
          // sekecil itu lebih sering meleset di ponsel (DECISIONS 247).
          <Link href={p.data.href} prefetch={false} className="block py-1.5 font-medium text-primary hover:underline">
            {p.data.tanggal}
            {p.data.hariIni ? <span className="ml-1.5 text-[11px] font-bold">· hari ini</span> : null}
          </Link>
        ) : null,
    },
    { field: "hari", headerName: "Hari", width: 110 },
    {
      field: "status",
      headerName: "Laporan",
      // `flex` supaya grid mengisi lebar layar. Tanpa ini 158 baris berdempet
      // di sepertiga kiri sementara dua pertiga kanan kosong.
      flex: 2,
      minWidth: 150,
      cellRenderer: (p: ICellRendererParams<BarisHarian>) =>
        p.data ? <StatusPill tone={p.data.tone} label={p.data.status} /> : null,
    },
    // Kolom angka ikut ber-`flex` supaya tidak terlempar ke ujung kanan layar,
    // 700px jauhnya dari status yang seharusnya dibaca bersamanya.
    { field: "itemCount", headerName: "Item", flex: 1, minWidth: 90, type: "numericColumn" },
    { field: "fotoCount", headerName: "Foto", flex: 1, minWidth: 90, type: "numericColumn" },
  ];
}

export function DaftarHarian({ rows }: { rows: BarisHarian[] }) {
  return (
    <MarlinGrid<BarisHarian>
      rowData={rows}
      columnDefs={kolom()}
      getRowId={(d) => d.dateKey}
      quickFilter
      csvExport
      rowLink
      // 50 = salah satu nilai pemilih bawaan AG Grid. Angka di luar daftar itu
      // (mis. 31) membuat pemilih "Baris per halaman" tampil KOSONG — terbaca
      // sebagai kerusakan.
      pageSize={50}
      height="65vh"
      persistKey="harian-riwayat"
      emptyText="Tidak ada tanggal pada saringan ini."
    />
  );
}
