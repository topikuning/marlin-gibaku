import { z } from "zod";
import type { PeriodeDiminta } from "./tanya-tanggal";

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

export const NIAT = [
  "kendala",
  "progress",
  "deviasi",
  "kelengkapan",
  /** Isi laporan harian satu tanggal — DECISIONS 356. */
  "laporan",
  /** Rekap posisi pekerjaan satu PEKAN — DECISIONS 358. */
  "laporan_mingguan",
  /** "kamu bisa apa saja?" — MARLIN menjelaskan dirinya sendiri. */
  "bantuan",
] as const;
export type Niat = (typeof NIAT)[number];

export const NIAT_LABEL: Record<Niat, string> = {
  kendala: "kendala lapangan",
  progress: "progress pekerjaan",
  deviasi: "deviasi terhadap kurva-S",
  kelengkapan: "kelengkapan laporan harian",
  laporan: "isi laporan harian satu tanggal",
  laporan_mingguan: "rekap mingguan (realisasi vs rencana per pekan)",
  bantuan: "daftar hal yang bisa saya jawab",
};

/**
 * Periode yang boleh diminta AI — BENTUKNYA saja, bukan tanggal hasil hitungan
 * (DECISIONS 356). Aritmetikanya di `tanya-tanggal.ts`.
 */
export const skemaPeriode = z.discriminatedUnion("jenis", [
  z.object({ jenis: z.literal("hari_ini") }),
  z.object({ jenis: z.literal("mundur_hari"), hari: z.number().int().min(0).max(400) }),
  z.object({
    jenis: z.literal("tanggal"),
    hari: z.number().int().min(1).max(31),
    bulan: z.number().int().min(1).max(12).nullable().default(null),
    tahun: z.number().int().min(2000).max(2100).nullable().default(null),
  }),
  z.object({
    jenis: z.literal("rentang"),
    satuan: z.enum(["minggu", "bulan"]),
    mundur: z.number().int().min(0).max(60),
  }),
]);

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
  /**
   * BENTUK periode yang dibaca dari kalimat. Tanggal nyatanya dihitung
   * `bacaPeriode()`, bukan oleh AI (DECISIONS 356).
   *
   * TOLERAN pada bentuk lama berupa string (`"hari_ini"`). Skema ini memeriksa
   * keluaran MODEL, bukan masukan program kita: satu kata yang meleset tidak
   * boleh menggagalkan seluruh parse dan membuat penanya menerima "AI sedang
   * tidak bisa membaca pertanyaan". Bentuk yang tak dikenal jatuh ke hari ini —
   * jawaban yang mungkin kurang tepat periodenya, tapi tetap berguna dan
   * periodenya SELALU disebut di judul balasan.
   */
  periode: z
    .preprocess((v) => {
      if (typeof v === "string") return { jenis: v === "hari_ini" ? "hari_ini" : v };
      return v;
    }, skemaPeriode)
    .catch({ jenis: "hari_ini" as const })
    .default({ jenis: "hari_ini" }),
});

export type NiatTerbaca = z.infer<typeof skemaNiat>;

export const PETUNJUK_SKEMA = `{
  "niat": "kendala" | "progress" | "deviasi" | "kelengkapan" | "laporan" | "laporan_mingguan" | "bantuan" | null,
  "lokasiDisebut": string[],
  "periode":
      { "jenis": "hari_ini" }
    | { "jenis": "mundur_hari", "hari": number }
    | { "jenis": "tanggal", "hari": number, "bulan": number|null, "tahun": number|null }
    | { "jenis": "rentang", "satuan": "minggu"|"bulan", "mundur": number }
}`;

export const SISTEM_PROMPT = [
  "Kamu penerjemah pertanyaan, BUKAN penjawab.",
  "Tugasmu HANYA mengubah pertanyaan berbahasa Indonesia bebas menjadi struktur JSON.",
  "",
  "Arti tiap niat:",
  "- kendala     : masalah/hambatan/kendala di lapangan",
  "- progress    : kemajuan/realisasi pekerjaan, berapa persen, sudah sampai mana",
  "- deviasi     : keterlambatan, deviasi, siapa yang tertinggal dari jadwal",
  "- kelengkapan : siapa yang sudah/belum membuat laporan harian",
  "- laporan     : ISI laporan harian satu tanggal — apa yang dikerjakan, cuaca,",
  "                jam kerja, jumlah tenaga kerja, foto. Dipakai untuk permintaan",
  "                seperti 'minta laporan harian', 'laporan tanggal 12', 'kirim",
  "                laporan kemarin'.",
  "- laporan_mingguan : rekap satu PEKAN — realisasi vs rencana, berapa hari sudah",
  "                     dilaporkan. Dipakai untuk 'laporan mingguan', 'rekap mingguan',",
  "                     'laporan minggu lalu', 'progress mingguan'.",
  "                     PENTING: 'laporan MINGGUAN' selalu laporan_mingguan, JANGAN",
  "                     dipetakan ke 'laporan' (yang itu laporan HARIAN satu tanggal).",
  "- bantuan     : penanya bertanya APA SAJA yang bisa kamu jawab / kamu bisa apa",
  "",
  "PERIODE — kamu HANYA melaporkan bentuk yang KAMU BACA. JANGAN menghitung tanggal.",
  "Kamu TIDAK tahu hari ini tanggal berapa, jadi menghitung sendiri pasti salah.",
  "  'hari ini', tidak disebut          -> {\"jenis\":\"hari_ini\"}",
  "  'kemarin'                          -> {\"jenis\":\"mundur_hari\",\"hari\":1}",
  "  'kemarin lusa', 'dua hari lalu'    -> {\"jenis\":\"mundur_hari\",\"hari\":2}",
  "  'seminggu lalu'                    -> {\"jenis\":\"mundur_hari\",\"hari\":7}",
  "  'tanggal 12'                       -> {\"jenis\":\"tanggal\",\"hari\":12,\"bulan\":null,\"tahun\":null}",
  "  '17 agustus'                       -> {\"jenis\":\"tanggal\",\"hari\":17,\"bulan\":8,\"tahun\":null}",
  "  '3 Juli 2025'                      -> {\"jenis\":\"tanggal\",\"hari\":3,\"bulan\":7,\"tahun\":2025}",
  "  'minggu ini' / 'minggu lalu'       -> {\"jenis\":\"rentang\",\"satuan\":\"minggu\",\"mundur\":0 atau 1}",
  "  'bulan ini' / 'bulan lalu'         -> {\"jenis\":\"rentang\",\"satuan\":\"bulan\",\"mundur\":0 atau 1}",
  "Kalau tahun tidak ditulis penanya, isi tahun = null. JANGAN menebaknya.",
  "",
  "ATURAN KERAS:",
  "1. Kalau pertanyaannya TIDAK jelas masuk salah satu niat di atas, isi niat = null.",
  "   JANGAN memilih yang paling mirip. Menebak lebih berbahaya daripada mengaku tidak tahu.",
  "2. lokasiDisebut diisi nama lokasi APA ADANYA seperti ditulis penanya, tanpa dibetulkan",
  "   ejaannya. Kalau tidak ada lokasi disebut, isi larik kosong.",
  "3. JANGAN pernah mengarang angka, tanggal, atau nama lokasi yang tidak ditulis penanya.",
  "4. Nama bulan/hari yang disebut penanya BUKAN nama lokasi.",
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
