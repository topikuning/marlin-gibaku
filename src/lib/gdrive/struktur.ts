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
 * Sembilan butir BERKAS DOKUMEN TEKNIS yang isinya sama dengan folder utama
 * termin (Kurva S, Laporan Mingguan, SSUK, …) dibuat sebagai PINTASAN Drive ke
 * folder utama itu, bukan folder kosong kedua (DECISIONS 776).
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
  /**
   * Bukan folder, melainkan PINTASAN Drive ke folder bernama ini yang sejajar
   * dengan induknya (DECISIONS 776): "BERKAS DOKUMEN TEKNIS/9. Kurva S" →
   * "5. Kurva S" di folder termin yang sama. Isinya satu, tempatnya dua.
   */
  pintasanKe?: string;
};

const daun = (...nama: string[]): SimpulFolder[] => nama.map((n) => ({ nama: n }));

/** Folder utama termin yang juga diminta lagi di BERKAS DOKUMEN TEKNIS. */
const SPK = "1. SPK & Adendum";
const SSUK = "2. SSUK & SKK";
const SHOP = "4. Shop Drawing";
const KURVA = "5. Kurva S";
const BACKUP = "6. Back Up Perhitungan Kemajuan Pekerjaan";
const MINGGUAN = "7. Laporan Mingguan";
const DOKUMENTASI = "8. Dokumentasi Pekerjaan Per Item";
const RAB = "12. RAB";

const pintas = (nama: string, ke: string): SimpulFolder => ({ nama, pintasanKe: ke });

/** Isi satu folder termin – mengikuti TERMIN 1 (25%) CV. Putera Fahlevi. */
export const ISI_TERMIN: SimpulFolder[] = [
  { nama: SPK },
  { nama: SSUK },
  { nama: "3. SPMK" },
  { nama: SHOP },
  { nama: KURVA },
  { nama: BACKUP },
  { nama: MINGGUAN },
  { nama: DOKUMENTASI },
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
  { nama: RAB },
  {
    nama: "BERKAS DOKUMEN TEKNIS",
    // Gabungan TERMIN 1 & 2 contoh; nomor 18 tidak ada di keduanya. Butir yang
    // isinya sama dengan folder utama = pintasan ke sana (DECISIONS 725, 776).
    anak: [
      pintas("1. Kontrak Konstruksi dan CCO (jika ada)", SPK),
      pintas("2. RAB dan HPS", RAB),
      pintas("3. Gambar Perencanaan (Shop Drawing)", SHOP),
      pintas("4. Backup Volume", BACKUP),
      ...daun("5. Laporan Harian"),
      pintas("6. Laporan Mingguan", MINGGUAN),
      ...daun("7. Laporan Bulanan"),
      pintas("8. Dokumentasi Pekerjaan", DOKUMENTASI),
      pintas("9. Kurva S", KURVA),
      ...daun("10. Hasil Pengujian Material", "11. Spesifikasi Teknis dan Gambar"),
      pintas("12. SSUK", SSUK),
      pintas("13. SSKK", SSUK),
      ...daun(
        "14. RKK",
        "15. RMPK",
        "16. RKS",
        "17. Harga Timpang",
        "19. Laporan Kemajuan Pekerjaan",
        "20. Surat Perintah Pemeriksaan PPK",
      ),
    ],
  },
];

/**
 * Folder termin ke-n dikenali dari "termin n" saja: "TERMIN 1 (25%) CV. Putera
 * Fahlevi" dan "Termin 1" sama-sama cocok, berapa pun persen & nama penyedianya.
 * `nama` sudah dinormalkan `kunciNamaFolder`.
 */
export function polaFolderTermin(terminKe: number): RegExp {
  return new RegExp(`^termin ${terminKe}( |$)`);
}

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
        cocok: polaFolderTermin(i + 1),
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

/** Jumlah seluruh folder DAN pintasan di pohon (untuk kabar & uji). */
export function hitungSimpul(pohon: readonly SimpulFolder[]): number {
  return pohon.reduce((n, s) => n + 1 + hitungSimpul(s.anak ?? []), 0);
}
