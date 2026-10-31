import type { DocumentType, JenisSuratPenyedia } from "@/generated/prisma/enums";
import { ISI_TERMIN, cocokSimpul, type SimpulFolder } from "@/lib/gdrive/struktur";

/**
 * KATALOG BERKAS TERMIN – MURNI (DECISIONS 720).
 *
 * 42 butir isi folder `7. BERKAS TERMIN/TERMIN n` Drive KKP (acuan TERMIN 1
 * CV. Putera Fahlevi), masing-masing dengan ASALNYA:
 *   - `marlin`     dibuat MARLIN (surat penyedia, laporan, kurva-S);
 *   - `paket`      sudah ada sebagai dokumen paket (kontrak, SPMK, RAB, …);
 *   - `tetap`      dokumen tetap penyedia, diunggah SEKALI dan dipakai ulang
 *                  tiap termin (NIB & NPWP per perusahaan, sisanya per kontrak);
 *   - `pihak_lain` datang dari PPK, konsultan, laboratorium, atau pajak SESUDAH
 *                  proses berjalan – MARLIN hanya mencatat dan mengingatkan.
 *
 * Nama folder diambil dari `ISI_TERMIN` (struktur Drive yang dibuat tombol
 * "Siapkan folder Drive"), bukan diketik ulang: daftar periksa dan folder
 * Drive tidak bisa berselisih nama. Uji menjaga setiap folder daun punya tepat
 * satu butir.
 */

export type SumberBerkas = "marlin" | "paket" | "tetap" | "pihak_lain";
export type LaporanMarlin = "kurva_s" | "mingguan" | "bulanan" | "harian" | "dokumentasi";

export type ButirBerkas = {
  /** Kode pendek: "9c", "10e", "T19" (BERKAS DOKUMEN TEKNIS no. 19). */
  kode: string;
  /** Jalur folder di bawah `TERMIN n`, persis nama di `ISI_TERMIN`. */
  jalur: readonly string[];
  sumber: SumberBerkas;
  /** Siapa yang memberikan berkas ini. */
  pemberi: string;
  /** Langkah penagihan tempat berkas ini dibutuhkan (lihat `LANGKAH_PENAGIHAN`). */
  langkah: number;
  /** Jenis dokumen saat diunggah di MARLIN. */
  jenisDokumen: DocumentType;
  surat?: JenisSuratPenyedia;
  laporan?: LaporanMarlin;
  /** Dokumen paket yang memenuhi butir ini. */
  dokumenPaket?: readonly DocumentType[];
  tetapDi?: "perusahaan" | "kontrak";
  /**
   * Butir lain yang unggahannya juga memenuhi butir ini: SSUK & SSKK di no. 2,
   * dan laporan yang sama di dua folder (Kurva S 5↔T9, Laporan Mingguan 7↔T6,
   * Dokumentasi 8↔T8 – DECISIONS 722): satu scan bertanda tangan mengisi keduanya.
   */
  juga?: readonly string[];
  /**
   * Satu berkas PER LOKASI aktif paket (DECISIONS 725). Berkas termin yang
   * lolos dan cair (TERMIN 1 CV. Putera Fahlevi) memuat Shop Drawing, Kurva S,
   * Back Up Volume, Laporan Mingguan, Dokumentasi, RAB, RKS, Laporan Harian,
   * dan Laporan Bulanan untuk TIAP desa – bukan satu untuk paket.
   */
  perLokasi?: true;
  /**
   * Butir BERKAS DOKUMEN TEKNIS yang hanya mengulang butir utama. Berkas yang
   * lolos tidak mengisinya sama sekali (T1–T4, T6, T8, T9, T12, T13), jadi
   * tidak dihitung kurang dan tidak diisi ulang (DECISIONS 725).
   */
  cukupDi?: string;
  /** Ada di berkas nyata tapi bukan folder baku `ISI_TERMIN` (mis. lepas di akar folder termin). */
  tambahan?: true;
  /** Nama tampilan bila `jalur` bukan folder daunnya sendiri. */
  nama?: string;
};

export const LANGKAH_PENAGIHAN: readonly { ke: number; judul: string; pemberi: string }[] = [
  { ke: 0, judul: "Syarat & berkas pendukung", pemberi: "MARLIN, penyedia" },
  { ke: 1, judul: "Laporan Kemajuan Pekerjaan konsultan", pemberi: "Konsultan pengawas" },
  { ke: 2, judul: "Surat Permohonan Pemeriksaan Pekerjaan", pemberi: "Penyedia (MARLIN)" },
  { ke: 3, judul: "Surat Perintah Pemeriksaan", pemberi: "PPK" },
  { ke: 4, judul: "BA Pembahasan Kemajuan Pekerjaan", pemberi: "Penyedia & konsultan (MARLIN)" },
  { ke: 5, judul: "BA Pemeriksaan Hasil & BA Persetujuan Prestasi", pemberi: "PPK" },
  { ke: 6, judul: "Permohonan Pembayaran, Invoice, Kwitansi, Faktur Pajak", pemberi: "Penyedia (MARLIN)" },
  { ke: 7, judul: "Nodin Reviu, BA Pembayaran, Karwas", pemberi: "PPK" },
  { ke: 8, judul: "Pembayaran cair", pemberi: "KPPN" },
];

const PEMERIKSAAN = "9. Pemeriksaan Pekerjaan";
const PEMBAYARAN = "10. Pembayaran";
const TEKNIS = "BERKAS DOKUMEN TEKNIS";

export const KATALOG_BERKAS_TERMIN: readonly ButirBerkas[] = [
  { kode: "1", jalur: ["1. SPK & Adendum"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "kontrak", dokumenPaket: ["kontrak", "adendum"], juga: ["T1"] },
  { kode: "2", jalur: ["2. SSUK & SKK"], sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 0, jenisDokumen: "kontrak", juga: ["T12", "T13"] },
  { kode: "3", jalur: ["3. SPMK"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "spmk", dokumenPaket: ["spmk"] },
  { kode: "4", jalur: ["4. Shop Drawing"], sumber: "paket", pemberi: "Penyedia", langkah: 0, jenisDokumen: "shop_drawing", dokumenPaket: ["shop_drawing"], perLokasi: true, juga: ["T3"] },
  { kode: "5", jalur: ["5. Kurva S"], sumber: "marlin", laporan: "kurva_s", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", perLokasi: true, juga: ["T9"] },
  { kode: "6", jalur: ["6. Back Up Perhitungan Kemajuan Pekerjaan"], sumber: "pihak_lain", pemberi: "Penyedia (backup volume per lokasi)", langkah: 0, jenisDokumen: "laporan", perLokasi: true, juga: ["T4"] },
  { kode: "7", jalur: ["7. Laporan Mingguan"], sumber: "marlin", laporan: "mingguan", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", perLokasi: true, juga: ["T6"] },
  { kode: "8", jalur: ["8. Dokumentasi Pekerjaan Per Item"], sumber: "marlin", laporan: "dokumentasi", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", perLokasi: true, juga: ["T8"] },
  { kode: "9a", jalur: [PEMERIKSAAN, "a. Surat Permohonan Pemeriksaan Pekerjaan"], sumber: "marlin", surat: "permohonan_pemeriksaan", pemberi: "Penyedia (MARLIN)", langkah: 2, jenisDokumen: "lainnya" },
  { kode: "9b", jalur: [PEMERIKSAAN, "b. BA Pembahasan Kemajuan Pekerjaan"], sumber: "marlin", surat: "ba_pembahasan_kemajuan", pemberi: "Penyedia & konsultan (MARLIN)", langkah: 4, jenisDokumen: "lainnya" },
  { kode: "9c", jalur: [PEMERIKSAAN, "c. BA Pemeriksaan Hasil Pekerjaan"], sumber: "pihak_lain", pemberi: "PPK / tim pemeriksa", langkah: 5, jenisDokumen: "lainnya" },
  { kode: "9d", jalur: [PEMERIKSAAN, "d. BA Persetujuan Prestasi Pekerjaan"], sumber: "pihak_lain", pemberi: "PPK", langkah: 5, jenisDokumen: "lainnya" },
  { kode: "10a", jalur: [PEMBAYARAN, "a. Surat Permohonan Pembayaran"], sumber: "marlin", surat: "permohonan_pembayaran", pemberi: "Penyedia (MARLIN)", langkah: 6, jenisDokumen: "invoice" },
  { kode: "10b", jalur: [PEMBAYARAN, "b. Invoice"], sumber: "marlin", surat: "invoice", pemberi: "Penyedia (MARLIN)", langkah: 6, jenisDokumen: "invoice" },
  { kode: "10c", jalur: [PEMBAYARAN, "c. Kwitansi"], sumber: "marlin", surat: "kwitansi", pemberi: "Penyedia (MARLIN)", langkah: 6, jenisDokumen: "invoice" },
  { kode: "10d", jalur: [PEMBAYARAN, "d. NPWP Penyedia"], sumber: "tetap", tetapDi: "perusahaan", pemberi: "Penyedia", langkah: 6, jenisDokumen: "lainnya" },
  { kode: "10e", jalur: [PEMBAYARAN, "e. Faktur Pajak"], sumber: "pihak_lain", pemberi: "Penyedia (faktur pajak termin ini)", langkah: 6, jenisDokumen: "faktur_pajak" },
  { kode: "10f", jalur: [PEMBAYARAN, "f. BA Pembayaran (sebelum SHR terbit)"], sumber: "pihak_lain", pemberi: "PPK", langkah: 7, jenisDokumen: "ba_pembayaran" },
  { kode: "10g", jalur: [PEMBAYARAN, "g. BA Pembayaran (setelah terbit SHR)"], sumber: "pihak_lain", pemberi: "PPK", langkah: 7, jenisDokumen: "ba_pembayaran" },
  { kode: "10h", jalur: [PEMBAYARAN, "h. Kualifikasi Perusahaan (NIB)"], sumber: "tetap", tetapDi: "perusahaan", pemberi: "Penyedia", langkah: 6, jenisDokumen: "lainnya" },
  { kode: "10i", jalur: [PEMBAYARAN, "i. Karwas"], sumber: "pihak_lain", pemberi: "PPK", langkah: 7, jenisDokumen: "lainnya" },
  { kode: "11", jalur: ["11. Nodin Permohonan Reviu"], sumber: "pihak_lain", pemberi: "PPK", langkah: 7, jenisDokumen: "lainnya" },
  { kode: "12", jalur: ["12. RAB"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "hps", dokumenPaket: ["hps"], perLokasi: true, juga: ["T2"] },
  { kode: "T1", jalur: [TEKNIS, "1. Kontrak Konstruksi dan CCO (jika ada)"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "kontrak", dokumenPaket: ["kontrak", "adendum"], cukupDi: "1" },
  { kode: "T2", jalur: [TEKNIS, "2. RAB dan HPS"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "hps", dokumenPaket: ["hps"], cukupDi: "12" },
  { kode: "T3", jalur: [TEKNIS, "3. Gambar Perencanaan (Shop Drawing)"], sumber: "paket", pemberi: "Penyedia", langkah: 0, jenisDokumen: "shop_drawing", dokumenPaket: ["shop_drawing", "ded"], cukupDi: "4" },
  { kode: "T4", jalur: [TEKNIS, "4. Backup Volume"], sumber: "pihak_lain", pemberi: "Penyedia (backup volume per lokasi)", langkah: 0, jenisDokumen: "laporan", cukupDi: "6" },
  { kode: "T5", jalur: [TEKNIS, "5. Laporan Harian"], sumber: "marlin", laporan: "harian", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", perLokasi: true },
  { kode: "T6", jalur: [TEKNIS, "6. Laporan Mingguan"], sumber: "marlin", laporan: "mingguan", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", cukupDi: "7" },
  { kode: "T7", jalur: [TEKNIS, "7. Laporan Bulanan"], sumber: "marlin", laporan: "bulanan", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", perLokasi: true },
  { kode: "T8", jalur: [TEKNIS, "8. Dokumentasi Pekerjaan"], sumber: "marlin", laporan: "dokumentasi", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", cukupDi: "8" },
  { kode: "T9", jalur: [TEKNIS, "9. Kurva S"], sumber: "marlin", laporan: "kurva_s", pemberi: "MARLIN", langkah: 0, jenisDokumen: "laporan", cukupDi: "5" },
  { kode: "T10", jalur: [TEKNIS, "10. Hasil Pengujian Material"], sumber: "pihak_lain", pemberi: "Penyedia (laboratorium uji)", langkah: 0, jenisDokumen: "lainnya" },
  { kode: "T11", jalur: [TEKNIS, "11. Spesifikasi Teknis dan Gambar"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "rks", dokumenPaket: ["rks", "ded"] },
  { kode: "T12", jalur: [TEKNIS, "12. SSUK"], sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 0, jenisDokumen: "kontrak", cukupDi: "2" },
  { kode: "T13", jalur: [TEKNIS, "13. SSKK"], sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 0, jenisDokumen: "kontrak", cukupDi: "2" },
  { kode: "T14", jalur: [TEKNIS, "14. RKK"], sumber: "paket", pemberi: "Penyedia", langkah: 0, jenisDokumen: "smkk", dokumenPaket: ["smkk"] },
  { kode: "T15", jalur: [TEKNIS, "15. RMPK"], sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 0, jenisDokumen: "lainnya" },
  { kode: "T16", jalur: [TEKNIS, "16. RKS"], sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "rks", dokumenPaket: ["rks"], perLokasi: true },
  { kode: "T17", jalur: [TEKNIS, "17. Harga Timpang"], sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 0, jenisDokumen: "lainnya" },
  { kode: "T19", jalur: [TEKNIS, "19. Laporan Kemajuan Pekerjaan"], sumber: "pihak_lain", pemberi: "Konsultan pengawas", langkah: 1, jenisDokumen: "laporan" },
  { kode: "T20", jalur: [TEKNIS, "20. Surat Perintah Pemeriksaan PPK"], sumber: "pihak_lain", pemberi: "PPK", langkah: 3, jenisDokumen: "lainnya" },
  // Ada di berkas nyata, di luar folder baku (DECISIONS 725): lepas di akar
  // folder termin (Putera Fahlevi) atau di folder Pembayaran (Lamongan).
  { kode: "JP", jalur: [], nama: "Jaminan Pelaksanaan", tambahan: true, sumber: "paket", pemberi: "Penyedia", langkah: 0, jenisDokumen: "jaminan", dokumenPaket: ["jaminan"] },
  { kode: "ST", jalur: [], nama: "Surat Tugas Pengawas Lapangan", tambahan: true, perLokasi: true, sumber: "pihak_lain", pemberi: "Konsultan pengawas", langkah: 0, jenisDokumen: "lainnya" },
  { kode: "SPPBJ", jalur: [], nama: "SPPBJ", tambahan: true, sumber: "paket", pemberi: "PPK", langkah: 0, jenisDokumen: "sppbj", dokumenPaket: ["sppbj"] },
  { kode: "RB", jalur: [PEMBAYARAN], nama: "Referensi Bank", tambahan: true, sumber: "tetap", tetapDi: "kontrak", pemberi: "Penyedia", langkah: 6, jenisDokumen: "lainnya" },
];

const PER_KODE = new Map(KATALOG_BERKAS_TERMIN.map((b) => [b.kode, b]));
export function butirBerkas(kode: string): ButirBerkas | null {
  return PER_KODE.get(kode) ?? null;
}

/** Simpul `ISI_TERMIN` di sepanjang `jalur` (untuk mencocokkan nama lama/alias). */
function simpulDi(jalur: readonly string[]): SimpulFolder | null {
  let tingkat: readonly SimpulFolder[] = ISI_TERMIN;
  let s: SimpulFolder | null = null;
  for (const nama of jalur) {
    s = tingkat.find((x) => x.nama === nama) ?? null;
    if (!s) return null;
    tingkat = s.anak ?? [];
  }
  return s;
}

/**
 * Jalur folder Drive → termin & butir. `jalur` = segmen folder dari akar Drive
 * paket, mis. ["7. BERKAS TERMIN", "TERMIN 2 (50%) CV. X",
 * "9. Pemeriksaan Pekerjaan", "c. BA Pemeriksaan Hasil Pekerjaan"]. Ejaan
 * dicocokkan longgar (huruf besar/kecil, tanda baca, spasi), sama dengan
 * pencocok folder Drive. Null bila bukan folder berkas termin.
 */
export function butirDariJalur(jalur: readonly string[]): { terminKe: number; kode: string } | null {
  const i = jalur.findIndex((seg) => /^termin\s*(\d+)\b/i.test(seg.trim()));
  if (i < 0) return null;
  const terminKe = Number(/^termin\s*(\d+)/i.exec(jalur[i].trim())![1]);
  const sisa = jalur.slice(i + 1);
  if (sisa.length === 0) return null;
  // Butir tambahan tidak punya folder sendiri – letaknya saja tidak cukup.
  for (const b of KATALOG_BERKAS_TERMIN.filter((x) => !x.tambahan)) {
    if (sisa.length < b.jalur.length) continue;
    let cocok = true;
    for (let k = 0; k < b.jalur.length; k++) {
      const simpul = simpulDi(b.jalur.slice(0, k + 1));
      if (!simpul || !cocokSimpul(simpul, sisa[k])) {
        cocok = false;
        break;
      }
    }
    if (cocok) return { terminKe, kode: b.kode };
  }
  return null;
}

/* ── Status ──────────────────────────────────────────────────────────────── */

export type StatusButir = "ada" | "sebagian" | "disiapkan_marlin" | "belum_dibuat" | "belum_diunggah" | "menunggu";

export const LABEL_STATUS_BUTIR: Record<StatusButir, string> = {
  ada: "Ada",
  sebagian: "Sebagian lokasi",
  disiapkan_marlin: "Disiapkan MARLIN",
  belum_dibuat: "Belum dibuat",
  belum_diunggah: "Belum diunggah",
  menunggu: "Menunggu",
};

export type KeadaanBerkas = {
  /** Surat penyedia yang sudah dibuat untuk termin ini. */
  surat: ReadonlySet<JenisSuratPenyedia>;
  /** Jenis dokumen paket (aktif) yang ada. */
  dokumenPaket: ReadonlySet<DocumentType>;
  /** Kode butir yang punya dokumen aktif untuk TERMIN INI. */
  butirTermin: ReadonlySet<string>;
  /** Kode butir tetap (per kontrak/perusahaan) yang punya dokumen aktif, termin mana pun. */
  butirTetap: ReadonlySet<string>;
};

/** Status satu butir untuk satu termin – diturunkan, tidak disimpan. */
export function statusButir(b: ButirBerkas, k: KeadaanBerkas): StatusButir {
  const kodeSetara = [b.kode, ...(b.juga ?? [])];
  if (kodeSetara.some((x) => k.butirTermin.has(x))) return "ada";
  switch (b.sumber) {
    case "marlin":
      if (b.surat) return k.surat.has(b.surat) ? "ada" : "belum_dibuat";
      return "disiapkan_marlin";
    case "paket":
      return (b.dokumenPaket ?? []).some((t) => k.dokumenPaket.has(t)) ? "ada" : "belum_diunggah";
    case "tetap":
      return kodeSetara.some((x) => k.butirTetap.has(x)) ? "ada" : "belum_diunggah";
    case "pihak_lain":
      return "menunggu";
  }
}

/**
 * Status butir per lokasi digabung jadi satu (DECISIONS 725): "ada" hanya bila
 * SEMUA lokasi aktif sudah punya berkasnya; sebagian ada = "sebagian". Lokasi
 * yang laporannya disiapkan MARLIN tidak dihitung kurang.
 */
export function gabungStatusLokasi(per: readonly StatusButir[]): StatusButir | null {
  if (per.length === 0) return null;
  if (per.every((x) => x === "ada")) return "ada";
  const kurang = per.filter((x) => x !== "ada" && x !== "disiapkan_marlin");
  if (kurang.length === 0) return "disiapkan_marlin";
  return kurang.length < per.length ? "sebagian" : kurang[0];
}

export type StatusLangkah = "selesai" | "berjalan" | "belum";

/** Langkah selesai bila semua butirnya ada (atau akan disiapkan MARLIN). */
export function statusLangkah(ke: number, status: ReadonlyMap<string, StatusButir>): StatusLangkah {
  // Butir duplikat (cukup di butir utama) tidak menahan langkah.
  const butir = KATALOG_BERKAS_TERMIN.filter((b) => b.langkah === ke && !b.cukupDi);
  if (butir.length === 0) return "belum";
  const beres = butir.filter((b) => {
    const s = status.get(b.kode);
    return s === "ada" || s === "disiapkan_marlin";
  }).length;
  if (beres === butir.length) return "selesai";
  return butir.some((b) => status.get(b.kode) === "ada" || status.get(b.kode) === "sebagian") ? "berjalan" : "belum";
}

/** Nama yang terbaca orang: "9c. BA Pemeriksaan Hasil Pekerjaan". */
export function namaButir(b: ButirBerkas): string {
  if (b.nama) return b.nama;
  const daun = b.jalur[b.jalur.length - 1].replace(/^[0-9a-z]+\.\s*/i, "");
  return `${b.kode}. ${daun}`;
}

/** Kunci pengelompokan tampilan menurut folder induk. */
export function kelompokButir(b: ButirBerkas): string {
  if (b.tambahan) return "Berkas pendukung lain";
  return b.jalur.length > 1 ? b.jalur[0] : "Berkas utama";
}
