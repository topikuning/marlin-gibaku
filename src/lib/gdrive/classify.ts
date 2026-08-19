import { KKP_FOLDERS } from "./folders";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * Menebak JENIS dokumen, FASE, dan LOKASI satu berkas Drive dari jalur folder +
 * nama filenya. MURNI (tanpa DB/network) supaya bisa diuji atas nama-nama file
 * KKP yang sebenarnya. DECISIONS 184.
 *
 * Prinsip: tebakan ini USULAN, bukan keputusan. Yang keliru diperbaiki manusia
 * di pratinjau impor sebelum apa pun masuk arsip — karena itu setiap usulan
 * membawa `alasan` (kenapa ditebak begitu) dan `keyakinan`.
 */

export type Keyakinan = "tinggi" | "sedang" | "rendah";

export type Klasifikasi = {
  type: DocumentType;
  phase: AdminPhase;
  keyakinan: Keyakinan;
  /** Kenapa ditebak begitu — ditampilkan di pratinjau. */
  alasan: string;
};

/** Huruf & angka saja, huruf kecil — untuk pencocokan tahan spasi/tanda baca. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Fase kanonik per jenis dokumen (dipakai saat menyimpan hasil impor). */
const PHASE_FOR_TYPE: Record<DocumentType, AdminPhase> = {
  hps: "pemilihan",
  ded: "pemilihan",
  rks: "pemilihan",
  smkk: "pemilihan",
  undangan: "pemilihan",
  ba_penjelasan: "pemilihan",
  penawaran: "pemilihan",
  ba_evaluasi: "pemilihan",
  ba_klarifikasi: "pemilihan",
  ba_negosiasi: "pemilihan",
  penetapan_pemenang: "penunjukan",
  sanggah: "penunjukan",
  sppbj: "penunjukan",
  jaminan: "kontrak",
  kontrak: "kontrak",
  spmk: "mulai_kerja",
  ba_serah_terima_lapangan: "mulai_kerja",
  pcm: "mulai_kerja",
  mc0: "mulai_kerja",
  shop_drawing: "pelaksanaan",
  laporan: "pelaksanaan",
  mc_berkala: "pelaksanaan",
  surat_kendala: "pelaksanaan",
  surat_peringatan: "pelaksanaan",
  adendum: "adendum",
  bast_pho: "serah_terima",
  bast_fho: "serah_terima",
  as_built: "serah_terima",
  ba_pembayaran: "pembayaran",
  invoice: "pembayaran",
  faktur_pajak: "pembayaran",
  lainnya: "lainnya",
};

export function phaseForType(type: DocumentType): AdminPhase {
  return PHASE_FOR_TYPE[type];
}

/**
 * Kata kunci nama file → jenis dokumen. Urutan PENTING: yang lebih spesifik
 * lebih dulu ("as built" sebelum "built", "mc 0" sebelum "mc"), karena
 * pencocokan berhenti pada kunci pertama yang cocok. Kata kunci diambil dari
 * penamaan berkas KKP yang berjalan (SPMK, BA PCM, MC-0, BAST-1, dst).
 */
const NAME_RULES: { keys: string[]; type: DocumentType }[] = [
  { keys: ["as built", "asbuilt"], type: "as_built" },
  { keys: ["shop drawing", "shopdrawing"], type: "shop_drawing" },
  { keys: ["faktur pajak", "e faktur", "efaktur"], type: "faktur_pajak" },
  { keys: ["invoice", "kwitansi", "kuitansi"], type: "invoice" },
  { keys: ["ba pembayaran", "berita acara pembayaran"], type: "ba_pembayaran" },
  { keys: ["bast 2", "bast ii", "fho", "serah terima akhir"], type: "bast_fho" },
  { keys: ["bast 1", "bast i", "pho", "serah terima pertama", "bast"], type: "bast_pho" },
  { keys: ["mc 0", "mc0", "mutual check 0", "mutual check awal"], type: "mc0" },
  { keys: ["opname", "mc berkala", "mc 1", "mc 2", "mc 3", "monthly certificate"], type: "mc_berkala" },
  { keys: ["pcm", "pre construction meeting"], type: "pcm" },
  { keys: ["adendum", "addendum", "cco", "change contract order"], type: "adendum" },
  { keys: ["spmk", "surat perintah mulai kerja"], type: "spmk" },
  { keys: ["sppbj"], type: "sppbj" },
  { keys: ["surat peringatan", "sp 1", "sp 2", "sp 3", "kontrak kritis"], type: "surat_peringatan" },
  { keys: ["kendala"], type: "surat_kendala" },
  { keys: ["jaminan", "garansi bank", "surety"], type: "jaminan" },
  { keys: ["serah terima lapangan", "serah terima lokasi", "peninjauan lokasi"], type: "ba_serah_terima_lapangan" },
  { keys: ["kontrak", "spk", "surat perjanjian"], type: "kontrak" },
  { keys: ["rab", "hps", "harga perkiraan"], type: "hps" },
  { keys: ["ded", "detail engineering", "gambar rencana"], type: "ded" },
  { keys: ["rks", "spesifikasi teknis", "rencana kerja dan syarat"], type: "rks" },
  { keys: ["smkk", "rkk", "keselamatan konstruksi", "k3"], type: "smkk" },
  { keys: ["laporan harian", "laporan mingguan", "laporan bulanan", "laporan kemajuan", "laporan"], type: "laporan" },
  { keys: ["undangan"], type: "undangan" },
  { keys: ["penetapan pemenang"], type: "penetapan_pemenang" },
  { keys: ["sanggah"], type: "sanggah" },
  { keys: ["negosiasi"], type: "ba_negosiasi" },
  { keys: ["evaluasi"], type: "ba_evaluasi" },
  { keys: ["klarifikasi", "pembuktian"], type: "ba_klarifikasi" },
  { keys: ["aanwijzing", "pemberian penjelasan"], type: "ba_penjelasan" },
  { keys: ["penawaran"], type: "penawaran" },
];

/**
 * Folder KKP → jenis default bila nama file tidak memberi petunjuk. Folder 6
 * (DOKUMENTASI) sengaja TIDAK dipetakan: isinya foto lapangan yang punya modul
 * sendiri — lihat `alasanDilewati`.
 */
const FOLDER_DEFAULT: Partial<Record<(typeof KKP_FOLDERS)[number], DocumentType>> = {
  "1. SPPBJ, SPK, SPMK, RAB, DED": "kontrak",
  "2. PCM": "pcm",
  "3. LAPORAN HARIAN": "laporan",
  "4. LAPORAN MINGGUAN": "laporan",
  "5. LAPORAN BULANAN": "laporan",
  "7. BERKAS TERMIN": "mc_berkala",
  "8. SHOP DRAWING": "shop_drawing",
  "9. AS BUILT": "as_built",
};

/** Cocokkan segmen jalur ke salah satu folder KKP baku (toleran ejaan/nomor). */
function kkpFolderOf(path: readonly string[]): (typeof KKP_FOLDERS)[number] | null {
  for (const seg of path) {
    const n = normalizeName(seg);
    for (const folder of KKP_FOLDERS) {
      const fn = normalizeName(folder);
      if (n === fn || n.startsWith(fn) || fn.startsWith(n)) return folder;
      // Pencocokan longgar via nomor awal folder ("6" → "6. DOKUMENTASI").
      const num = fn.split(" ")[0];
      if (n === num || n.startsWith(`${num} `)) return folder;
    }
  }
  return null;
}

function matchName(haystack: string): DocumentType | null {
  for (const rule of NAME_RULES) {
    for (const key of rule.keys) if (haystack.includes(key)) return rule.type;
  }
  return null;
}

/**
 * Klasifikasi satu berkas. Nama file menang atas folder: folder KKP sering jadi
 * keranjang campuran ("1. SPPBJ, SPK, SPMK, RAB, DED" memuat lima jenis).
 */
export function classifyDriveFile(input: {
  fileName: string;
  path: readonly string[];
}): Klasifikasi {
  const namaBersih = normalizeName(input.fileName.replace(/\.[a-z0-9]{1,5}$/i, ""));
  const folder = kkpFolderOf(input.path);

  const dariNama = matchName(namaBersih);
  if (dariNama) {
    return {
      type: dariNama,
      phase: phaseForType(dariNama),
      keyakinan: folder && FOLDER_DEFAULT[folder] === dariNama ? "tinggi" : "sedang",
      alasan: `nama berkas menyebut jenisnya${folder ? ` (folder "${folder}")` : ""}`,
    };
  }

  // Nama file tidak bicara — coba folder tempat ia berada.
  const dariFolder = folder ? FOLDER_DEFAULT[folder] : undefined;
  if (dariFolder) {
    return {
      type: dariFolder,
      phase: phaseForType(dariFolder),
      keyakinan: "rendah",
      alasan: `nama berkas tidak menyebut jenis – ditebak dari folder "${folder}"`,
    };
  }

  // Terakhir: kata kunci di jalur folder (mis. subfolder "Adendum").
  const dariJalur = matchName(normalizeName(input.path.join(" ")));
  if (dariJalur) {
    return {
      type: dariJalur,
      phase: phaseForType(dariJalur),
      keyakinan: "rendah",
      alasan: "ditebak dari nama folder induk",
    };
  }

  return {
    type: "lainnya",
    phase: "lainnya",
    keyakinan: "rendah",
    alasan: "jenis tidak terbaca dari nama berkas maupun folder – pilih manual",
  };
}

/**
 * Cocokkan berkas ke LOKASI (desa) paket: nama desa dicari di jalur folder dulu
 * (lapisan "<Nama Lokasi>" yang dibuat MARLIN), baru di nama berkas. Cocok
 * sebagian saja tidak cukup — nama desa harus muncul sebagai kata utuh supaya
 * "Pesisir" tidak menyambar "Pesisirwetan".
 */
export function matchLocation(
  input: { fileName: string; path: readonly string[] },
  locations: readonly { id: string; name: string }[],
): { locationId: string; locationName: string; dari: "folder" | "nama berkas" } | null {
  const kandidat = [...locations].sort((a, b) => b.name.length - a.name.length);
  const jalur = ` ${normalizeName(input.path.join(" "))} `;
  const nama = ` ${normalizeName(input.fileName)} `;
  for (const sumber of [
    { hay: jalur, dari: "folder" as const },
    { hay: nama, dari: "nama berkas" as const },
  ]) {
    for (const loc of kandidat) {
      const needle = ` ${normalizeName(loc.name)} `;
      if (needle.trim() && sumber.hay.includes(needle)) {
        return { locationId: loc.id, locationName: loc.name, dari: sumber.dari };
      }
    }
  }
  return null;
}

/**
 * Alasan satu berkas TIDAK ditawarkan untuk diimpor (null = boleh diimpor).
 * Foto lapangan dikecualikan karena punya modul sendiri (galeri berstempel);
 * menariknya ke Document Center hanya menggandakan arsip.
 */
export function alasanDilewati(input: {
  fileName: string;
  mimeType: string;
  path: readonly string[];
  /** Mime yang diterima Document Center (kanonik) + native Google. */
  didukung: (mime: string) => boolean;
}): string | null {
  const folder = kkpFolderOf(input.path);
  if (folder === "6. DOKUMENTASI") {
    return "folder dokumentasi foto – foto lapangan dikelola di modul Kegiatan/Foto, bukan arsip dokumen";
  }
  if (input.mimeType.startsWith("image/") && (input.fileName.match(/^(img|dsc|photo|foto)[-_ ]?\d+/i))) {
    return "berkas foto kamera – bukan dokumen administrasi";
  }
  if (!input.didukung(input.mimeType)) {
    return `jenis berkas tidak didukung (${input.mimeType})`;
  }
  return null;
}

/* ── Tanggal dari nama berkas ────────────────────────────────────────────── */

const BULAN_ID: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, april: 4, apr: 4,
  mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8, september: 9, sep: 9,
  sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
};

/** Tahun yang masuk akal untuk berkas proyek — menahan "MC-2 2 1" jadi tanggal. */
function tahunWajar(y: number): boolean {
  return y >= 2020 && y <= 2035;
}

function tanggalValid(y: number, m: number, d: number): Date | null {
  if (!tahunWajar(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Kolom docDate bertipe @db.Date — disimpan sebagai tengah malam UTC.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/**
 * Ambil TANGGAL DOKUMEN dari nama berkas bila ditulis jelas. Hanya tiga bentuk
 * yang diterima — yang lain dibiarkan kosong, karena tanggal salah lebih
 * merugikan daripada tanggal kosong (ia ikut membentuk nama tampilan dokumen
 * dan pengelompokan berkas). Null = biar manusia yang isi.
 */
export function extractDocDate(fileName: string): Date | null {
  const s = fileName.replace(/\.[a-z0-9]{1,5}$/i, "");

  // 1) yyyy-mm-dd / yyyy_mm_dd (juga menangkap awalan "20260512" berpemisah)
  const iso = s.match(/(20\d{2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})(?!\d)/);
  if (iso) {
    const d = tanggalValid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }

  // 2) dd-mm-yyyy / dd.mm.yyyy
  const dmy = s.match(/(?<!\d)(\d{1,2})[-_.\/](\d{1,2})[-_.\/](20\d{2})(?!\d)/);
  if (dmy) {
    const d = tanggalValid(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    if (d) return d;
  }

  // 3) "12 Mei 2026" (nama bulan Indonesia)
  const teks = normalizeName(s).match(/(?:^|\s)(\d{1,2}) ([a-z]+) (20\d{2})(?:\s|$)/);
  if (teks) {
    const bulan = BULAN_ID[teks[2]];
    if (bulan) {
      const d = tanggalValid(Number(teks[3]), bulan, Number(teks[1]));
      if (d) return d;
    }
  }
  return null;
}
