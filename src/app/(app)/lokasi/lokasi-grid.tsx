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

/**
 * IDENTITAS BARIS DIKUNCI DI KIRI — nama lokasi DAN wilayahnya, dalam SATU
 * kolom bertumpuk.
 *
 * Keluhan user 2026-08-12: *"ketika scroll ke kanan/kiri, tidak tahu itu data
 * progress lokasi mana."* Tabel ini lebih lebar dari satu layar, jadi begitu
 * digulir ke kanan yang tersisa cuma deretan angka tanpa pemiliknya — dan angka
 * progres tanpa nama lokasi bukan sekadar tidak berguna, tapi berbahaya: paling
 * mudah dibaca sebagai milik lokasi yang salah.
 *
 * ### Kenapa SATU kolom, bukan dua kolom dikunci berdampingan
 *
 * Dua kolom terkunci (190 + 150 = 340 px) sudah diukur di peramban sungguhan
 * dan GAGAL di layar ponsel: pada viewport 390 px AG Grid menolak menahan area
 * terkunci selebar itu, lalu MELEPAS kuncinya sendiri — dan yang dilepas justru
 * kolom Lokasi. Hasilnya kebalikan dari yang diminta: Wilayah menempel di kiri
 * sementara nama lokasi ikut hanyut ke kanan. Diam-diam pula, tanpa peringatan
 * apa pun.
 *
 * Menyempitkan keduanya sampai muat pun bukan jawaban: di layar 390 px, dua
 * kolom terkunci menyisakan ~110 px untuk menggulir — persis ruang yang sedang
 * dikeluhkan. Ditumpuk dalam satu kolom, keduanya tetap terbaca penuh dan ruang
 * gulirnya kira-kira dua kali lipat. Pola yang sama sudah dipakai tabel
 * "Per lokasi" di halaman Progress.
 *
 * Kolom Wilayah tersendiri TETAP ada (tidak dikunci): ia yang menyediakan
 * pengurutan, penyaringan, dan kolomnya di CSV. Yang di sel terkunci adalah
 * KETERANGAN, bukan penggantinya.
 *
 * Nama paket sengaja TIDAK dikunci (permintaan user): perlu ada, tapi bukan
 * identitas yang dicari mata saat menggulir.
 */
const COLUMN_DEFS: ColDef<LokasiRow>[] = [
  {
    field: "name",
    headerName: "Lokasi",
    pinned: "left",
    // Lebar TETAP, bukan `flex`. Kolom ber-flex melebar mengisi sisa ruang;
    // pada kolom terkunci itu berarti area gulirnya yang menyusut — kebalikan
    // dari yang dibutuhkan.
    width: 190,
    minWidth: 160,
    cellRenderer: (p: ICellRendererParams<LokasiRow>) =>
      p.data ? (
        // `block py-1.5` — tautannya mengisi tinggi sel, bukan seutas teks
        // setinggi 16px. Sasaran ketuk sekecil itu lebih sering meleset
        // daripada kena di ponsel (DECISIONS 247).
        <Link href={`/lokasi/${p.data.slug}`} className="block py-1.5 leading-tight">
          <span className="block font-medium text-primary hover:underline">{p.data.name}</span>
          <span className="block text-xs text-ink-muted">{p.data.wilayah}</span>
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
      /*
       * 60 px, dan angkanya diukur — bukan dikira-kira.
       *
       * Isi sel Lokasi setinggi 44 px (dua baris + padding). AG Grid menaruh
       * lajur penggulir mendatarnya setinggi 16 px MENUMPANG di dasar badan
       * grid, jadi ia menutupi 16 px terakhir BARIS TERAKHIR. Dengan baris
       * 52 px, baris terakhir kehilangan ekor huruf pada baris wilayahnya —
       * hanya baris terakhir, hanya kalau tabelnya bisa digulir mendatar,
       * yaitu persis keadaan yang sedang diperbaiki di sini.
       *
       * Diukur di build produksi: isi sel mulai 1 px di bawah puncak baris,
       * jadi syaratnya 1 + 44 + 16 = 61. Dipakai 64 supaya ada 3 px kelonggaran
       * — angka yang pas-pasan akan berbalik merah oleh pembulatan sub-piksel,
       * dan penjaga yang berdiri di tepi jurang tidak menjaga apa pun.
       */
      rowHeight={64}
      persistKey="lokasi-list"
      getRowId={(r) => r.id}
      // SELURUH BARIS membuka lokasinya. Sebelumnya satu-satunya sasaran
      // adalah tautan nama seluas 2,4% baris — ketukan di mana pun selain di
      // situ tidak melakukan APA PUN, dan itulah yang di lapangan terbaca
      // "aplikasi tidak merespon" lalu diketuk berulang kali (DECISIONS 247).
      rowLink
      emptyText="Belum ada lokasi yang bisa diakses."
    />
  );
}
