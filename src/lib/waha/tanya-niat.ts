import { z } from "zod";

/**
 * NIAT pertanyaan WhatsApp bebas — skema + pencocokan nama lokasi
 * (DECISIONS 339). MURNI: tanpa DB, tanpa AI, supaya bisa diuji langsung.
 *
 * AI hanya mengisi struktur ini; ia TIDAK PERNAH menghasilkan angka. Angkanya
 * datang dari calc layer sesudahnya (`ai-hub/source.ts`: *"AI tidak pernah
 * query DB"*, DECISIONS 133/193).
 *
 * ### Dua kegagalan yang harus MENGAKU, bukan menebak
 *
 * 1. **Niat tidak dikenali.** Balasan yang terdengar meyakinkan tapi salah jauh
 *    lebih merusak daripada "belum saya mengerti" — apalagi lewat WhatsApp yang
 *    di-screenshot dan diteruskan ke PPK.
 * 2. **Nama lokasi ambigu.** "kendala di Kedung" saat ada Kedung Mutih dan
 *    Kedungmalang: MARLIN harus BALIK BERTANYA menyebut keduanya, bukan
 *    memilih sendiri. Memilih sendiri menghasilkan jawaban yang benar untuk
 *    lokasi yang salah — dan tidak ada yang bisa membedakannya.
 */

export const NIAT = ["kendala", "progress", "deviasi", "kelengkapan"] as const;
export type Niat = (typeof NIAT)[number];

export const NIAT_LABEL: Record<Niat, string> = {
  kendala: "kendala lapangan",
  progress: "progress pekerjaan",
  deviasi: "deviasi terhadap kurva-S",
  kelengkapan: "kelengkapan laporan harian",
};

/**
 * Skema yang WAJIB diisi AI. Sengaja sempit: makin sedikit yang boleh
 * dikarang AI, makin sedikit yang bisa salah.
 */
export const skemaNiat = z.object({
  /** null = AI tidak yakin. WAJIB null, bukan tebakan terdekat. */
  niat: z.enum(NIAT).nullable(),
  /**
   * Nama lokasi APA ADANYA seperti ditulis penanya — belum dicocokkan.
   * Kosong = pertanyaan lintas lokasi.
   */
  lokasiDisebut: z.array(z.string().min(1)).max(20),
  /** Periode yang diminta; hanya "hari_ini" yang didukung v1. */
  periode: z.enum(["hari_ini"]).default("hari_ini"),
});

export type NiatTerbaca = z.infer<typeof skemaNiat>;

export const PETUNJUK_SKEMA = `{
  "niat": "kendala" | "progress" | "deviasi" | "kelengkapan" | null,
  "lokasiDisebut": string[],
  "periode": "hari_ini"
}`;

export const SISTEM_PROMPT = [
  "Kamu penerjemah pertanyaan, BUKAN penjawab.",
  "Tugasmu HANYA mengubah pertanyaan berbahasa Indonesia bebas menjadi struktur JSON.",
  "",
  "Arti tiap niat:",
  "- kendala     : menanyakan masalah/hambatan/kendala di lapangan",
  "- progress    : menanyakan kemajuan/realisasi pekerjaan",
  "- deviasi     : menanyakan keterlambatan, deviasi, atau siapa yang tertinggal dari jadwal",
  "- kelengkapan : menanyakan siapa yang sudah/belum membuat laporan harian",
  "",
  "ATURAN KERAS:",
  "1. Kalau pertanyaannya TIDAK jelas masuk salah satu niat di atas, isi niat = null.",
  "   JANGAN memilih yang paling mirip. Menebak lebih berbahaya daripada mengaku tidak tahu.",
  "2. lokasiDisebut diisi nama lokasi APA ADANYA seperti ditulis penanya, tanpa dibetulkan",
  "   ejaannya. Kalau tidak ada lokasi disebut, isi larik kosong.",
  "3. JANGAN pernah mengarang angka, tanggal, atau nama lokasi yang tidak ditulis penanya.",
].join("\n");

/* ------------------------------------------------------------------ */
/* Pencocokan nama lokasi                                              */
/* ------------------------------------------------------------------ */

export type LokasiKatalog = { id: string; nama: string };

export type HasilCocok =
  | { jenis: "tepat"; lokasi: LokasiKatalog }
  | { jenis: "ambigu"; kandidat: LokasiKatalog[] }
  | { jenis: "tidak_ada" };

/** Samakan bentuk untuk perbandingan: huruf kecil, tanpa tanda baca & spasi ganda. */
export function normalNama(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cocokkan satu nama yang disebut penanya ke katalog lokasi.
 *
 * Berlapis dari yang paling pasti:
 *   1. sama persis (setelah dinormalkan)
 *   2. katalog MENGANDUNG yang diketik ("kedung" → "Kedung Mutih")
 *
 * Kalau lapis 2 menghasilkan lebih dari satu, hasilnya **ambigu** — bukan yang
 * pertama. Memilih sendiri menghasilkan jawaban yang benar untuk lokasi yang
 * salah, dan penanya tidak punya cara mengetahuinya.
 */
export function cocokkanLokasi(diketik: string, katalog: LokasiKatalog[]): HasilCocok {
  const q = normalNama(diketik);
  if (!q) return { jenis: "tidak_ada" };

  const persis = katalog.filter((l) => normalNama(l.nama) === q);
  if (persis.length === 1) return { jenis: "tepat", lokasi: persis[0] };
  if (persis.length > 1) return { jenis: "ambigu", kandidat: persis };

  const mengandung = katalog.filter((l) => normalNama(l.nama).includes(q));
  if (mengandung.length === 1) return { jenis: "tepat", lokasi: mengandung[0] };
  if (mengandung.length > 1) return { jenis: "ambigu", kandidat: mengandung };

  return { jenis: "tidak_ada" };
}

export type HasilResolusi = {
  /** Lokasi yang berhasil dicocokkan tepat. */
  cocok: LokasiKatalog[];
  /** Nama yang ambigu, beserta kandidatnya — penanya harus ditanya balik. */
  ambigu: { diketik: string; kandidat: LokasiKatalog[] }[];
  /** Nama yang tidak ada di katalog (atau di luar izin penanya). */
  tidakDikenal: string[];
};

/** Cocokkan seluruh nama yang disebut; kumpulkan yang bermasalah, jangan buang. */
export function resolusiLokasi(diketik: string[], katalog: LokasiKatalog[]): HasilResolusi {
  const hasil: HasilResolusi = { cocok: [], ambigu: [], tidakDikenal: [] };
  const sudah = new Set<string>();
  for (const nama of diketik) {
    const c = cocokkanLokasi(nama, katalog);
    if (c.jenis === "tepat") {
      if (!sudah.has(c.lokasi.id)) {
        sudah.add(c.lokasi.id);
        hasil.cocok.push(c.lokasi);
      }
    } else if (c.jenis === "ambigu") {
      hasil.ambigu.push({ diketik: nama, kandidat: c.kandidat });
    } else {
      hasil.tidakDikenal.push(nama);
    }
  }
  return hasil;
}
