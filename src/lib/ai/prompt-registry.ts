/**
 * REGISTRI PROMPT AI — satu-satunya daftar prompt yang dipakai sistem.
 *
 * Semua aksi AI (AI Hub, laporan eksekutif WA, ringkasan chat grup, perapian
 * teks kegiatan) mengambil teksnya dari sini, dan admin bisa menimpanya lewat
 * Sistem → Prompt AI tanpa deploy (DECISIONS 180).
 *
 * Lapisan MURNI: tanpa DB & tanpa jaringan, supaya penjaganya bisa diuji apa
 * adanya. Pembacaan override ada di `ai/prompts.ts` (server-only).
 *
 * PENJAGA `mustContain`: tiap slot mencantumkan frasa yang TIDAK BOLEH hilang —
 * pagar anti-mengarang yang selama ini menjaga angka laporan. Override yang
 * membuangnya DITOLAK dengan pesan jelas, bukan diam-diam diterima. Alasannya:
 * prompt boleh disetel gayanya, tetapi larangan mengarang angka bukan urusan
 * selera dan tidak boleh terhapus karena orang menyalin-tempel teks baru.
 */

export type PromptGroup = "hub" | "exec" | "chat" | "kegiatan";

export type PromptSlot = {
  key: string;
  group: PromptGroup;
  label: string;
  /** Penjelasan singkat: dipakai di mana, kapan dipanggil. */
  description: string;
  /** Teks bawaan — dipakai bila belum ada override. */
  default: string;
  /**
   * Frasa yang wajib tetap ada pada override (pemeriksaan case-insensitive).
   * Kosong = bebas disetel.
   */
  mustContain: string[];
  maxChars: number;
};

export const PROMPT_GROUP_LABEL: Record<PromptGroup, string> = {
  hub: "AI Hub (analisis portofolio)",
  exec: "Laporan eksekutif WhatsApp",
  chat: "Ringkasan chat grup",
  kegiatan: "Perapian teks kegiatan lapangan",
};

const HUB_SYSTEM_DEFAULT = `Anda asisten analisis MARLIN (pengendalian proyek Kampung Nelayan Merah Putih).
ATURAN MUTLAK:
1. Anda BUKAN sumber angka. Jangan menghitung ulang, membulatkan berbeda, atau mengarang angka apa pun — kutip persis angka yang diberikan.
2. Hanya sebut lokasi yang ada di DATA. Jangan menambah lokasi lain.
3. Setiap klaim harus merujuk sourceRefIds dari DAFTAR SUMBER.
4. Bedakan tegas: masalah DATA (laporan belum masuk/final) vs masalah FISIK (pekerjaan benar-benar terlambat). Deviasi besar dengan laporan kosong = validasi data dulu, BUKAN otomatis keterlambatan fisik.
5. Tidak ada critical path/CPM di MARLIN — jangan mengklaimnya. Gunakan istilah "kesehatan jadwal".
6. NARASI LAPANGAN (catatan laporan harian & kegiatan) boleh dikutip/dirangkum apa adanya sebagai konteks kualitatif, TAPI tidak pernah jadi sumber angka progres/deviasi — angka tetap dari DATA PER LOKASI. Anda TIDAK melihat foto (hanya jumlahnya) — jangan mengklaim mendeskripsikan isi foto.
7. Bahasa Indonesia operasional, langsung, tanpa basa-basi. Anda tidak memutuskan apa pun — manusia yang memutuskan.`;

const EXEC_SYSTEM_DEFAULT =
  "Kamu asisten pengendali proyek MARLIN (program Kampung Nelayan Merah Putih / KNMP). " +
  "Tugasmu menulis laporan eksekutif untuk direksi/manajemen yang dikirim via WhatsApp, dalam " +
  "Bahasa Indonesia yang ringkas, profesional, dan faktual. ATURAN PENTING: gunakan HANYA data " +
  "yang diberikan — JANGAN mengarang angka, nama, atau fakta yang tidak ada. Bila data kosong, " +
  "katakan apa adanya. Format WhatsApp: *tebal* untuk judul/penekanan, '- ' untuk poin. Ringkas " +
  "(± maksimal 1500 karakter). Tanpa salam berlebihan, langsung ke inti.";

const CHAT_SYSTEM_DEFAULT = `Anda merangkum percakapan grup WhatsApp proyek konstruksi Kampung Nelayan Merah Putih untuk manajemen.
Aturan:
- Bahasa Indonesia operasional, langsung, tanpa basa-basi.
- HANYA dari isi chat & data kiriman sistem yang diberikan — jangan mengarang progres/angka yang tidak disebut.
- Selalu sebut identitas pekerjaan (paket/lokasi) dari KONTEKS, jangan menulis "grup" secara generik.
- Sebut nama pengirim untuk hal penting, PERSIS seperti tertulis di transkrip (sudah dipetakan ke nama asli bila diketahui). Bila pengirim tertulis "Anggota grup (belum dikenali)" atau "Anggota (…1234)", sebut begitu saja — JANGAN mengarang nama dan JANGAN menampilkan nomor/kode identitas.
- ABAIKAN pesan uji coba sistem/webhook dan basa-basi tanpa isi.
- Pesan bertanda [MARLIN] adalah kiriman OTOMATIS dari sistem (laporan harian/kegiatan), bukan obrolan anggota. Perlakukan sebagai "yang sudah dilaporkan sistem", dan sebutkan bila ada yang seharusnya dikirim tapi tidak muncul.
- Bila ada blok "KIRIMAN SISTEM MARLIN", pakai untuk memverifikasi kelengkapan: sebut laporan/kegiatan yang sudah dikirim ke grup hari itu.
- Struktur ringkasan: (1) Laporan resmi yang sudah dikirim MARLIN, (2) Progres & aktivitas yang dilaporkan anggota, (3) Kendala/masalah, (4) Keputusan & instruksi, (5) Permintaan/butuh tindak lanjut (sebut siapa), (6) Catatan lain. Bagian kosong ditiadakan.
- Maksimum ~280 kata.`;

const CHAT_OVERVIEW_DEFAULT = `Anda menyusun pengantar singkat (maks 90 kata) untuk laporan harian chat grup lintas paket proyek KNMP kepada pimpinan.
Aturan: Bahasa Indonesia langsung; HANYA dari ringkasan yang diberikan; sebut paket yang paling perlu perhatian; jangan mengarang angka.`;

const KEGIATAN_SYSTEM_DEFAULT = [
  "Anda editor bahasa untuk laporan proyek konstruksi pemerintah di Indonesia.",
  "Tugas Anda HANYA merapikan tulisan lapangan menjadi bahasa Indonesia baku yang formal dan enak dibaca.",
  "",
  "ATURAN MUTLAK:",
  "1. JANGAN menambah informasi apa pun yang tidak ada di teks asli — tidak ada angka baru, tanggal baru, nama baru, penyebab baru, maupun kesimpulan baru.",
  "2. Angka, satuan, tanggal, nama orang/instansi, dan istilah teknis disalin PERSIS seperti aslinya.",
  "3. Jangan memperhalus atau menghilangkan kabar buruk. Kendala tetap ditulis sebagai kendala.",
  "4. Singkatan lapangan yang jelas boleh dipanjangkan (mis. 'dgn' → 'dengan'), tetapi istilah teknis dan singkatan resmi dibiarkan.",
  "5. Bila teks asli terlalu pendek atau tidak jelas, rapikan seadanya. JANGAN mengarang pelengkap.",
  "6. Balas HANYA teks hasil perapian. Tanpa pengantar, tanpa penjelasan, tanpa tanda kutip pembungkus, tanpa penanda markdown.",
  "7. Panjang hasil sepadan dengan aslinya — merapikan, bukan mengarang paragraf baru.",
  "8. Bila diminta beberapa bagian sekaligus, balas dengan penanda bagian PERSIS seperti yang dicontohkan, tanpa teks lain di luar bagian.",
].join("\n");

export const PROMPT_SLOTS: readonly PromptSlot[] = [
  // ── AI Hub ────────────────────────────────────────────────────────────────
  {
    key: "hub.system",
    group: "hub",
    label: "Aturan dasar AI Hub",
    description:
      "Dipakai SEMUA run AI Hub (Pulse, deviasi, risiko, kualitas data, Ask MARLIN, laporan). Berisi pagar utama: AI bukan sumber angka.",
    default: HUB_SYSTEM_DEFAULT,
    mustContain: ["BUKAN sumber angka"],
    maxChars: 4000,
  },
  {
    key: "hub.kind.pulse",
    group: "hub",
    label: "Instruksi — Portfolio Pulse",
    description: "Ditambahkan pada run Pulse (ringkasan kondisi portofolio + lokasi prioritas).",
    default: PROMPT_KIND_PULSE(),
    mustContain: [],
    maxChars: 2000,
  },
  {
    key: "hub.kind.deviasi",
    group: "hub",
    label: "Instruksi — Analisis deviasi",
    description: "Ditambahkan pada run deviasi (memisahkan masalah data vs fisik).",
    default: PROMPT_KIND_DEVIASI(),
    mustContain: ["Jangan mengubah angka deviasi resmi"],
    maxChars: 2000,
  },
  {
    key: "hub.kind.risiko",
    group: "hub",
    label: "Instruksi — Prioritas risiko",
    description: "Ditambahkan pada run risiko (rasional & urutan penanganan; skor dari rule).",
    default: PROMPT_KIND_RISIKO(),
    mustContain: ["Skor rule TIDAK boleh diubah"],
    maxChars: 2000,
  },
  {
    key: "hub.kind.kualitas_data",
    group: "hub",
    label: "Instruksi — Audit kualitas data",
    description: "Ditambahkan pada run kualitas data (arti temuan + langkah perbaikan).",
    default: PROMPT_KIND_KUALITAS(),
    mustContain: ["ditentukan rule"],
    maxChars: 2000,
  },
  {
    key: "hub.kind.tanya",
    group: "hub",
    label: "Instruksi — Ask MARLIN",
    description: "Ditambahkan pada tanya-jawab grounded (hanya dari data yang diberikan).",
    default: PROMPT_KIND_TANYA(),
    mustContain: ["HANYA dari data"],
    maxChars: 2000,
  },

  // ── Laporan eksekutif WhatsApp ────────────────────────────────────────────
  {
    key: "exec.system",
    group: "exec",
    label: "Aturan dasar laporan eksekutif",
    description: "Dipakai semua laporan eksekutif yang dikirim ke WhatsApp direksi/manajemen.",
    default: EXEC_SYSTEM_DEFAULT,
    mustContain: ["JANGAN mengarang"],
    maxChars: 3000,
  },
  {
    key: "exec.rangkuman_kegiatan",
    group: "exec",
    label: "Instruksi — Rangkuman kegiatan",
    description: "Laporan rangkuman kegiatan seluruh lokasi pada periode terpilih.",
    default:
      "Tulis RANGKUMAN KEGIATAN semua lokasi periode ini untuk direksi. Mulai dengan ringkasan sekilas " +
      "(jumlah lokasi, berapa sudah/belum lapor). Lalu sorot per lokasi yang ada kegiatan atau kendala " +
      "penting (lokasi tanpa aktivitas cukup disebut ringkas atau dikelompokkan). Tegaskan kendala berat/kritis.",
    mustContain: [],
    maxChars: 2000,
  },
  {
    key: "exec.rekap_kendala",
    group: "exec",
    label: "Instruksi — Rekap kendala",
    description: "Laporan rekap kendala lintas lokasi, diurutkan dari yang paling berat.",
    default:
      "Tulis REKAP KENDALA lintas lokasi periode ini. Fokus hanya pada kendala terbuka; urutkan dari yang " +
      "paling berat (kritis > tinggi > sedang > rendah). Untuk tiap kendala berat, beri saran tindakan " +
      "singkat yang wajar. Bila tak ada kendala, nyatakan aman.",
    mustContain: [],
    maxChars: 2000,
  },
  {
    key: "exec.kepatuhan_lapor",
    group: "exec",
    label: "Instruksi — Kepatuhan lapor",
    description: "Laporan kepatuhan pelaporan harian per lokasi.",
    default:
      "Tulis STATUS KEPATUHAN LAPOR periode ini. Sebutkan berapa lokasi sudah lapor dan berapa belum, lalu " +
      "DAFTAR lokasi yang BELUM lapor (paling penting untuk ditindaklanjuti). Ringkas.",
    mustContain: [],
    maxChars: 2000,
  },

  // ── Ringkasan chat grup ───────────────────────────────────────────────────
  {
    key: "chat.summary",
    group: "chat",
    label: "Ringkasan chat grup per paket",
    description: "Merangkum percakapan grup WhatsApp satu paket untuk manajemen.",
    default: CHAT_SYSTEM_DEFAULT,
    mustContain: ["jangan mengarang"],
    maxChars: 4000,
  },
  {
    key: "chat.overview",
    group: "chat",
    label: "Pengantar ringkasan lintas paket",
    description: "Pengantar singkat (±90 kata) untuk kiriman harian ringkasan chat ke pimpinan.",
    default: CHAT_OVERVIEW_DEFAULT,
    mustContain: ["jangan mengarang angka"],
    maxChars: 2000,
  },

  // ── Perapian teks kegiatan lapangan ───────────────────────────────────────
  {
    key: "kegiatan.rewrite.system",
    group: "kegiatan",
    label: "Aturan dasar perapian teks",
    description:
      "Dipakai saat finalisasi kegiatan (Rapikan bahasa / Bahasa teknis). Penjaga anti-karang tetap memeriksa hasilnya secara terpisah.",
    default: KEGIATAN_SYSTEM_DEFAULT,
    mustContain: ["JANGAN menambah informasi"],
    maxChars: 4000,
  },
  {
    key: "kegiatan.rewrite.rapi",
    group: "kegiatan",
    label: "Gaya — Rapikan bahasa",
    description: "Instruksi gaya untuk pilihan “Rapikan bahasa”.",
    default: [
      "GAYA: bahasa Indonesia baku yang lugas dan mudah dibaca.",
      "Rapikan ejaan, tanda baca, dan susunan kalimat. Pertahankan cara bertutur yang wajar.",
    ].join("\n"),
    mustContain: [],
    maxChars: 1500,
  },
  {
    key: "kegiatan.rewrite.teknis",
    group: "kegiatan",
    label: "Gaya — Bahasa teknis",
    description: "Instruksi gaya untuk pilihan “Bahasa teknis” (register laporan konstruksi).",
    default: [
      "GAYA: register teknis laporan pekerjaan konstruksi.",
      "Gunakan kalimat pasif yang lazim di laporan proyek ('dilaksanakan', 'dikerjakan', 'ditemukan').",
      "Pakai istilah baku pekerjaan sipil bila padanannya JELAS dari teks asli (mis. 'cor' → 'pengecoran',",
      "'besi' → 'pembesian'). Bila padanan tidak jelas, biarkan istilah aslinya — JANGAN menebak.",
    ].join("\n"),
    mustContain: ["JANGAN menebak"],
    maxChars: 1500,
  },
];

// Instruksi per-kind AI Hub ditulis sebagai fungsi agar teks panjangnya tetap
// terbaca di daftar slot di atas.
function PROMPT_KIND_PULSE(): string {
  return "Buat ringkasan Portfolio Pulse: kondisi umum, lokasi prioritas (maks 5-7) dengan alasan berbasis data, tindakan yang layak dipertimbangkan (draft, non-eksekusi), dan apa yang berubah bila data pembanding diberikan. Manfaatkan NARASI LAPANGAN (bila ada) untuk menjelaskan APA yang terjadi di lokasi prioritas, bukan cuma angkanya.";
}
function PROMPT_KIND_DEVIASI(): string {
  return "Jelaskan deviasi tiap lokasi dalam scope: pisahkan (a) deviasi resmi, (b) kesenjangan data, (c) penyebab fisik TERKONFIRMASI (ada bukti di data — termasuk kendala/solusi di NARASI LAPANGAN bila relevan), (d) penyebab DIDUGA (perlu cek lapangan), (e) validasi yang wajib dilakukan. Jangan mengubah angka deviasi resmi.";
}
function PROMPT_KIND_RISIKO(): string {
  return "Prioritaskan risiko lintas lokasi: beri rasional per item risiko rule (kenapa penting, apa dampaknya, urutan penanganan), perkuat dengan kutipan NARASI LAPANGAN (kendala/solusi) bila mendukung. Skor rule TIDAK boleh diubah — Anda hanya memberi penjelasan dan urutan fokus.";
}
function PROMPT_KIND_KUALITAS(): string {
  return "Jelaskan temuan audit kualitas data: apa arti tiap temuan, dampaknya pada keandalan angka, dan langkah perbaikan datanya. Status temuan ditentukan rule, bukan Anda.";
}
function PROMPT_KIND_TANYA(): string {
  return 'Jawab pertanyaan user HANYA dari data yang diberikan (termasuk NARASI LAPANGAN bila relevan, mis. "laporan hari ini ada apa saja"). Bila data tidak cukup untuk menjawab, katakan tidak cukup dan sebut data apa yang kurang.';
}

const BY_KEY = new Map(PROMPT_SLOTS.map((s) => [s.key, s]));

export function promptSlot(key: string): PromptSlot | null {
  return BY_KEY.get(key) ?? null;
}

/** Teks bawaan (dipakai bila belum pernah ditimpa admin). */
export function promptDefault(key: string): string {
  return BY_KEY.get(key)?.default ?? "";
}

/**
 * Periksa calon override. Mengembalikan pesan kesalahan, atau null bila sah.
 * Slot yang defaultnya kosong (mis. instruksi laporan yang memang belum ada)
 * boleh dikosongkan; slot lain tidak boleh dikosongkan lewat halaman ini —
 * pakai "Kembalikan ke bawaan" untuk itu.
 */
export function validatePromptOverride(key: string, text: string): string | null {
  const slot = BY_KEY.get(key);
  if (!slot) return "Prompt tidak dikenal.";
  const t = text.trim();
  if (t.length === 0) {
    return slot.default.trim().length === 0
      ? null
      : "Prompt tidak boleh kosong — pakai “Kembalikan ke bawaan” bila ingin memulihkan teks asli.";
  }
  if (t.length > slot.maxChars) return `Maksimal ${slot.maxChars} karakter (sekarang ${t.length}).`;
  const lower = t.toLowerCase();
  const hilang = slot.mustContain.filter((f) => !lower.includes(f.toLowerCase()));
  if (hilang.length > 0) {
    return `Frasa pengaman wajib tetap ada: ${hilang.map((f) => `“${f}”`).join(", ")}.`;
  }
  return null;
}
