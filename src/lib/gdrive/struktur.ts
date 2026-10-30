import { AMBANG_TERMIN_PCT } from "@/lib/kesiapan/rules";
import { ALIAS_FOLDER_AKAR, KKP_FOLDERS, SUB_FOLDER_2, cleanPath, kunciNamaFolder } from "./folders";

/**
 * STRUKTUR FOLDER DRIVE KKP SATU PAKET – MURNI (DECISIONS 715).
 *
 * Permintaan user 2026-10-30: Drive yang sudah tersambung tetapi masih kosong
 * dibuatkan kerangka foldernya. Contohnya Drive KKP paket CV. Putera Fahlevi,
 * dengan TERMIN 1 yang sudah lengkap dan cair sebagai acuan isi berkas termin:
 *
 *   9 folder baku · sub-folder folder 1 & 2 · <Lokasi> di folder laporan dan
 *   dokumentasi · 4 folder termin, masing-masing 12 bagian + rincian
 *   pemeriksaan (a–d), pembayaran (a–i), dan BERKAS DOKUMEN TEKNIS.
 *
 * Nama ditulis PERSIS seperti di Drive KKP. Pencocokan dengan folder yang sudah
 * ada dilakukan longgar (`kunciNamaFolder`), dan folder termin dikenali dari
 * nomornya saja – nama penyedia di folder buatan KKP tidak selalu sama ejaannya
 * dengan data MARLIN.
 */

export type SimpulFolder = {
  nama: string;
  /** Nama lain yang dianggap folder yang sama (nama lama). */
  alias?: readonly string[];
  /** Pencocok khusus atas kunci nama (lihat `kunciNamaFolder`). */
  cocok?: RegExp;
  anak?: SimpulFolder[];
};

const daun = (...nama: string[]): SimpulFolder[] => nama.map((n) => ({ nama: n }));

/** Isi satu folder termin – mengikuti TERMIN 1 (25%) CV. Putera Fahlevi. */
export const ISI_TERMIN: SimpulFolder[] = [
  { nama: "1. SPK & Adendum" },
  { nama: "2. SSUK & SKK" },
  { nama: "3. SPMK" },
  { nama: "4. Shop Drawing" },
  { nama: "5. Kurva S" },
  { nama: "6. Back Up Perhitungan Kemajuan Pekerjaan" },
  { nama: "7. Laporan Mingguan" },
  { nama: "8. Dokumentasi Pekerjaan Per Item" },
  {
    nama: "9. Pemeriksaan Pekerjaan",
    anak: daun(
      "a. Surat Permohonan Pemeriksaan Pekerjaan",
      "b. BA Pembahasan Kemajuan Pekerjaan",
      "c. BA Pemeriksaan Hasil Pekerjaan",
      "d. BA Persetujuan Prestasi Pekerjaan",
    ),
  },
  {
    nama: "10. Pembayaran",
    anak: [
      ...daun("a. Surat Permohonan Pembayaran", "b. Invoice", "c. Kwitansi", "d. NPWP Penyedia", "e. Faktur Pajak"),
      // Termin berikutnya di Drive KKP menyatukan f & g jadi "f. BA Pembayaran".
      { nama: "f. BA Pembayaran (sebelum SHR terbit)", alias: ["f. BA Pembayaran"] },
      ...daun("g. BA Pembayaran (setelah terbit SHR)", "h. Kualifikasi Perusahaan (NIB)", "i. Karwas"),
    ],
  },
  { nama: "11. Nodin Permohonan Reviu" },
  { nama: "12. RAB" },
  {
    nama: "BERKAS DOKUMEN TEKNIS",
    // Gabungan TERMIN 1 & 2 contoh; nomor 18 tidak ada di keduanya.
    anak: daun(
      "1. Kontrak Konstruksi dan CCO (jika ada)",
      "2. RAB dan HPS",
      "3. Gambar Perencanaan (Shop Drawing)",
      "4. Backup Volume",
      "5. Laporan Harian",
      "6. Laporan Mingguan",
      "7. Laporan Bulanan",
      "8. Dokumentasi Pekerjaan",
      "9. Kurva S",
      "10. Hasil Pengujian Material",
      "11. Spesifikasi Teknis dan Gambar",
      "12. SSUK",
      "13. SSKK",
      "14. RKK",
      "15. RMPK",
      "16. RKS",
      "17. Harga Timpang",
      "19. Laporan Kemajuan Pekerjaan",
      "20. Surat Perintah Pemeriksaan PPK",
    ),
  },
];

/** Nama folder termin: "TERMIN 1 (25%) CV. Putera Fahlevi". */
export function namaFolderTermin(terminKe: number, pct: number, penyedia: string | null): string {
  return `TERMIN ${terminKe} (${pct}%)${penyedia?.trim() ? ` ${penyedia.trim()}` : ""}`;
}

/**
 * Pohon folder baku satu paket. `lokasi` = nama lokasi aktif paket; dipakai di
 * folder yang memang diisi MARLIN per lokasi (laporan harian/mingguan/bulanan
 * dan dokumentasi), dengan ejaan yang sama dengan unggahan otomatis.
 */
export function strukturDriveKkp(input: { penyedia: string | null; lokasi: readonly string[] }): SimpulFolder[] {
  const perLokasi = (): SimpulFolder[] =>
    cleanPath([...input.lokasi]).map((nama) => ({ nama }));
  const [f1, f2, f3, f4, f5, f6, f7, f8, f9] = KKP_FOLDERS;
  return [
    { nama: f1, anak: daun("DED", "RAB", "RKS") },
    { nama: f2, alias: ALIAS_FOLDER_AKAR[f2], anak: daun(...SUB_FOLDER_2) },
    { nama: f3, anak: perLokasi() },
    { nama: f4, anak: perLokasi() },
    { nama: f5, anak: perLokasi() },
    { nama: f6, anak: perLokasi() },
    {
      nama: f7,
      anak: AMBANG_TERMIN_PCT.map((pct, i) => ({
        nama: namaFolderTermin(i + 1, pct, input.penyedia),
        // "TERMIN 1 (25%) CV. Putera Fahlevi" dikenali dari "termin 1" saja.
        cocok: new RegExp(`^termin ${i + 1}( |$)`),
        anak: ISI_TERMIN,
      })),
    },
    { nama: f8 },
    { nama: f9 },
  ];
}

/** Folder yang ada cocok dengan simpul ini? */
export function cocokSimpul(simpul: SimpulFolder, namaAda: string): boolean {
  const k = kunciNamaFolder(namaAda);
  if (simpul.cocok) return simpul.cocok.test(k);
  return k === kunciNamaFolder(simpul.nama) || (simpul.alias ?? []).some((a) => k === kunciNamaFolder(a));
}

/** Jumlah seluruh folder di pohon (untuk kabar & uji). */
export function hitungSimpul(pohon: readonly SimpulFolder[]): number {
  return pohon.reduce((n, s) => n + 1 + hitungSimpul(s.anak ?? []), 0);
}
