/**
 * Klasifikasi pesan chat grup — MURNI (tanpa DB), deterministik & unit-tested.
 * Menjawab prinsip UX: "pesan pendek berkonteks rendah tidak boleh terlihat
 * sama bobotnya dengan pesan penting". Hasilnya dipakai UI (tag) DAN prompt AI
 * (urutan/porsi konteks). AI tidak menentukan relevansi — rule yang menentukan.
 * DECISIONS 139.
 */

/** Tingkat relevansi untuk ringkasan manajemen. */
export type Relevance = "sangat_relevan" | "relevan" | "perlu_interpretasi" | "konteks_rendah";

/** Jenis informasi operasional. */
export type InfoCategory =
  | "kendala"
  | "tindak_lanjut"
  | "progres"
  | "koordinasi"
  | "administrasi"
  | "lainnya";

export const RELEVANCE_LABEL: Record<Relevance, string> = {
  sangat_relevan: "Sangat relevan",
  relevan: "Relevan",
  perlu_interpretasi: "Perlu interpretasi",
  konteks_rendah: "Konteks rendah",
};

export const RELEVANCE_TONE: Record<Relevance, "danger" | "success" | "warning" | "neutral"> = {
  sangat_relevan: "danger",
  relevan: "success",
  perlu_interpretasi: "warning",
  konteks_rendah: "neutral",
};

export const CATEGORY_LABEL: Record<InfoCategory, string> = {
  kendala: "Kendala",
  tindak_lanjut: "Tindak lanjut",
  progres: "Progres",
  koordinasi: "Koordinasi",
  administrasi: "Administrasi",
  lainnya: "Lainnya",
};

/** Kata kunci per kategori (lower-case, dicek sebagai kata utuh bila memungkinkan). */
const KEYWORDS: Record<Exclude<InfoCategory, "lainnya">, string[]> = {
  kendala: [
    "kendala", "masalah", "terlambat", "telat", "belum datang", "belum ada", "gagal", "rusak",
    "macet", "terhambat", "hambatan", "kurang", "habis", "banjir", "hujan deras", "longsor",
    "protes", "komplain", "keluhan", "tidak bisa", "stop", "berhenti",
  ],
  tindak_lanjut: [
    "tolong", "mohon", "segera", "besok", "harap", "ditunggu", "follow up", "tindak lanjut",
    "koordinasi dengan", "hubungi", "minta", "perlu", "harus", "deadline", "target",
  ],
  progres: [
    "progres", "progress", "selesai", "sudah", "capai", "pengecoran", "galian", "timbunan",
    "pemasangan", "pekerjaan", "volume", "realisasi", "terpasang", "dikerjakan", "mulai",
  ],
  administrasi: [
    "invoice", "tagihan", "kontrak", "adendum", "spmk", "dokumen", "berita acara", "ba ",
    "laporan", "termin", "pembayaran", "surat", "izin", "perizinan", "ttd", "tanda tangan",
  ],
  koordinasi: [
    "rapat", "meeting", "pcm", "kunjungan", "survei", "survey", "jadwal", "agenda",
    "kades", "lurah", "camat", "dinas", "ppk", "direksi", "pengawas", "konsultan", "kopdes",
  ],
};

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/** Kategori informasi — prioritas: kendala > tindak lanjut > progres > administrasi > koordinasi. */
export function categorizeMessage(body: string): InfoCategory {
  const t = body.toLowerCase();
  if (hasAny(t, KEYWORDS.kendala)) return "kendala";
  if (hasAny(t, KEYWORDS.tindak_lanjut)) return "tindak_lanjut";
  if (hasAny(t, KEYWORDS.progres)) return "progres";
  if (hasAny(t, KEYWORDS.administrasi)) return "administrasi";
  if (hasAny(t, KEYWORDS.koordinasi)) return "koordinasi";
  return "lainnya";
}

export type ClassifyInput = {
  body: string;
  hasMedia: boolean;
  /** Pesan sudah disaring sebagai uji sistem/basa-basi (isNoiseMessage). */
  noise: boolean;
  fromMe: boolean;
};

export type MessageClass = {
  relevance: Relevance;
  category: InfoCategory;
  /** Ikut jadi bahan ringkasan AI. */
  useForSummary: boolean;
  /** Alasan singkat — ditampilkan sebagai tooltip/keterangan di UI. */
  reason: string;
};

const SHORT_LEN = 25;

/**
 * Klasifikasi satu pesan. Deterministik; tidak pernah membuang pesan dari arsip
 * (hanya menandai) — keputusan tampil/tidak ada di pemanggil.
 */
export function classifyMessage(input: ClassifyInput): MessageClass {
  const body = input.body.trim();
  const category = categorizeMessage(body);

  if (input.fromMe) {
    return {
      relevance: "relevan",
      category: "administrasi",
      useForSummary: true,
      reason: "Kiriman resmi MARLIN ke grup",
    };
  }
  if (input.noise) {
    return {
      relevance: "konteks_rendah",
      category: "lainnya",
      useForSummary: false,
      reason: "Uji sistem / basa-basi tanpa isi",
    };
  }

  // Media tanpa teks: ada bukti, tapi maknanya perlu dibuka manusia.
  if (body.length === 0 && input.hasMedia) {
    return {
      relevance: "perlu_interpretasi",
      category: "lainnya",
      useForSummary: true,
      reason: "Lampiran tanpa keterangan — isi perlu dilihat manusia",
    };
  }

  if (category === "kendala") {
    return {
      relevance: "sangat_relevan",
      category,
      useForSummary: true,
      reason: "Memuat indikasi kendala/hambatan",
    };
  }
  if (category === "tindak_lanjut") {
    return {
      relevance: "sangat_relevan",
      category,
      useForSummary: true,
      reason: "Memuat permintaan/instruksi tindak lanjut",
    };
  }
  if (category === "progres" || category === "administrasi") {
    return { relevance: "relevan", category, useForSummary: true, reason: "Melaporkan progres/administrasi" };
  }
  if (category === "koordinasi") {
    return { relevance: "relevan", category, useForSummary: true, reason: "Koordinasi dengan pihak terkait" };
  }

  // Tidak terklasifikasi: pendek → konteks rendah; panjang → perlu interpretasi.
  if (body.length < SHORT_LEN) {
    return {
      relevance: "konteks_rendah",
      category: "lainnya",
      useForSummary: false,
      reason: "Pesan pendek tanpa kata kunci operasional",
    };
  }
  return {
    relevance: "perlu_interpretasi",
    category: "lainnya",
    useForSummary: true,
    reason: "Tidak cocok kata kunci — perlu dibaca manusia",
  };
}

/** Ringkasan hitungan untuk KPI panel. MURNI. */
export function summarizeClasses(classes: MessageClass[]): {
  total: number;
  used: number;
  excluded: number;
  byRelevance: Record<Relevance, number>;
  byCategory: Record<InfoCategory, number>;
} {
  const byRelevance: Record<Relevance, number> = {
    sangat_relevan: 0,
    relevan: 0,
    perlu_interpretasi: 0,
    konteks_rendah: 0,
  };
  const byCategory: Record<InfoCategory, number> = {
    kendala: 0,
    tindak_lanjut: 0,
    progres: 0,
    koordinasi: 0,
    administrasi: 0,
    lainnya: 0,
  };
  let used = 0;
  for (const c of classes) {
    byRelevance[c.relevance]++;
    byCategory[c.category]++;
    if (c.useForSummary) used++;
  }
  return { total: classes.length, used, excluded: classes.length - used, byRelevance, byCategory };
}

/** Urutan prioritas untuk porsi konteks prompt (paling penting dulu). */
export const RELEVANCE_ORDER: Record<Relevance, number> = {
  sangat_relevan: 0,
  relevan: 1,
  perlu_interpretasi: 2,
  konteks_rendah: 3,
};
