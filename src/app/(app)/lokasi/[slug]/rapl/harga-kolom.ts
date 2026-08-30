import type { CellClassParams, ColDef, ValueFormatterParams } from "ag-grid-community";
import { rupiahCol } from "@/components/grid/kolom";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

/**
 * Susunan kolom layar "Kebutuhan & harga".
 *
 * Dipisah dari komponennya supaya bisa DIUJI: `marlin-grid.tsx` menarik
 * `ag-grid-react` saat diimpor, dan itu tidak jalan di uji unit berlingkungan
 * node. Dijaga `tests/unit/rapl-kolom-harga.test.ts`.
 *
 * Dua hal yang ditentukan di sini, keduanya karena keluhan user 2026-08-30
 * ("saran dari AI memang masuk tabel, tapi secara tampilan tidak kelihatan"):
 *
 * 1. **Tanpa draf, kolom AI tidak ada.** Ketiganya menghabiskan ±520px untuk
 *    memajang sel kosong, dan itulah yang mendorong kolom lain keluar layar.
 * 2. **Dengan draf, urutan kolom berubah, bukan isinya.** Keputusan yang
 *    sedang diminta — Usulan AI, keyakinannya, dan harga yang akan diganti —
 *    naik ke sepertiga kiri; kolom turunan (biaya, sumber harga) turun ke
 *    kanan. Tidak ada kolom yang hilang: yang ingin melihatnya tinggal
 *    menggulir, dan itu pilihannya, bukan nasibnya.
 */

export const LABEL_KATEGORI: Record<string, string> = {
  bahan: "Bahan",
  upah: "Upah",
  alat: "Alat",
  fasilitas: "Fasilitas",
};

export type BarisHargaRow = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  /** BigInt diserialisasi; null = belum berharga. */
  harga: string | null;
  biaya: string | null;
  sumber: string | null;
  /** Nilai RAB yang tertahan oleh sumber daya ini — pengurut, bukan uang. */
  nilaiTertahan: string;
  /** Harga sumber daya yang sama di lokasi lain — bahan pertimbangan. */
  rekomendasi: { harga: string; lokasi: string; kabupaten: string; seKabupaten: boolean }[];
};

export type Baris = BarisHargaRow & {
  /** Angka polos untuk grid — AG Grid tidak mengurut string rupiah. */
  hargaNum: number | null;
  biayaNum: number | null;
  rekomendasiTeks: string;
  usulanId: string | null;
  usulanAiNum: number | null;
  keyakinanAi: string;
  alasanAi: string;
};

export function kolomHarga({
  canInput,
  adaDraf,
}: {
  canInput: boolean;
  adaDraf: boolean;
}): ColDef<Baris>[] {
  const nama: ColDef<Baris> = {
    field: "nama",
    headerName: "Sumber daya",
    flex: 2,
    minWidth: 200,
    filter: true,
    cellClass: (p: CellClassParams<Baris>) => (p.data?.harga === null ? "text-ink-muted" : ""),
  };

  const kategori: ColDef<Baris> = {
    field: "kategori",
    headerName: "Kategori",
    width: 100,
    filter: true,
    valueFormatter: (p: ValueFormatterParams<Baris>) =>
      LABEL_KATEGORI[String(p.value)] ?? String(p.value),
  };

  const jumlah: ColDef<Baris> = {
    field: "jumlah",
    headerName: "Kebutuhan",
    width: 120,
    type: "numericColumn",
    valueFormatter: (p: ValueFormatterParams<Baris>) =>
      p.value == null ? "" : formatNumber(Number(p.value)),
    cellClass: "tabular text-right",
  };

  const satuan: ColDef<Baris> = { field: "satuan", headerName: "Satuan", width: 80 };

  const harga: ColDef<Baris> = {
    ...rupiahCol<Baris>("hargaNum", "Harga satuan"),
    width: 150,
    // Inilah satu-satunya kolom yang boleh diedit. Sisanya turunan.
    editable: canInput,
    cellClass: () => cn("tabular text-right", canInput && "bg-[var(--color-surface-muted)]"),
  };

  const biaya: ColDef<Baris> = { ...rupiahCol<Baris>("biayaNum", "Biaya"), width: 150 };

  const sumber: ColDef<Baris> = {
    field: "sumber",
    headerName: "Sumber harga",
    minWidth: 170,
    flex: 1,
    filter: true,
    cellClass: "text-ink-muted",
  };

  const rekomendasi: ColDef<Baris> = {
    field: "rekomendasiTeks",
    headerName: "Harga di lokasi lain",
    flex: 1,
    minWidth: 200,
    cellClass: "text-ink-muted",
    tooltipField: "rekomendasiTeks",
  };

  if (!adaDraf) return [nama, kategori, jumlah, satuan, harga, biaya, sumber, rekomendasi];

  const usulan: ColDef<Baris> = {
    ...rupiahCol<Baris>("usulanAiNum", "Usulan AI"),
    width: 150,
    // Ditandai supaya tidak terbaca sebagai harga yang sudah berlaku: angkanya
    // belum tersimpan dan belum masuk kalkulasi mana pun.
    cellClass: "tabular text-right font-semibold text-ink bg-info-soft",
  };

  const keyakinan: ColDef<Baris> = {
    field: "keyakinanAi",
    headerName: "Keyakinan",
    width: 110,
    cellClass: "text-ink-muted bg-info-soft",
  };

  const alasan: ColDef<Baris> = {
    field: "alasanAi",
    headerName: "Dasar usulan AI",
    flex: 1,
    minWidth: 220,
    cellClass: "text-ink-muted",
    tooltipField: "alasanAi",
  };

  return [nama, kategori, satuan, usulan, keyakinan, harga, alasan, rekomendasi, jumlah, biaya, sumber];
}
