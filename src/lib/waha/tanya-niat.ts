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
  /**
   * Kendala yang DIBUKA pada periode itu — apa pun statusnya sekarang
   * (DECISIONS 381).
   */
  "kendala_dibuka",
  /** Kendala yang dibuka pada periode itu DAN masih terbuka sekarang. */
  "kendala_periode_terbuka",
  "progress",
  "deviasi",
  "kelengkapan",
  /** Isi laporan harian satu tanggal — DECISIONS 356. */
  "laporan",
  /** Rekap posisi pekerjaan satu PEKAN — DECISIONS 358. */
  "laporan_mingguan",
  /**
   * Rekap posisi pekerjaan satu BULAN kalender (audit 2026-08-28).
   *
   * Bukan rumus baru: `dataMingguan` menerima rentang apa pun, jadi yang
   * berbeda dari mingguan hanya batas tanggalnya — dan aturan potongnya dibuat
   * SAMA persis supaya dua rekap tidak menghasilkan dua angka untuk hal yang
   * sama.
   *
   * Ditambahkan karena kadens pelaporan ke pemberi kerja memang bulanan,
   * sementara satu-satunya rekap yang ada berhenti di pekan — sehingga
   * "laporan bulanan" terbaca sebagai laporan harian HARI INI.
   */
  "laporan_bulanan",
  /**
   * RENCANA KERJA satu pekan — apa yang AKAN dikerjakan (DECISIONS 458).
   *
   * Satu-satunya niat yang menghadap KE DEPAN. Semua niat lain melaporkan apa
   * yang sudah terjadi; yang ini menjawab "minggu depan ngapain" dan "apa yang
   * harus dikerjakan untuk mengejar" — pertanyaan yang dulu jatuh ke jalur
   * kutipan catatan lapangan dan dijawab dengan notulen rapat bulan lalu.
   */
  "rencana",
  /**
   * PERMINTAAN MEMBUAT/MENGIRIM ARTEFAK — "buatkan laporan eksekutif",
   * "export excel progress", "kirim pdf laporan ke pak PPK" (audit 2026-08-28).
   *
   * Bukan pertanyaan, melainkan PERINTAH. Dulu tidak ada niat untuk ini, dan
   * akibatnya bukan "tidak mengerti" melainkan salah paham yang PERCAYA DIRI:
   * kata kerjanya ("buatkan", "export", "kirim") dibuang, kata bendanya yang
   * memutuskan, sehingga *"buatkan laporan eksekutif untuk direksi"* dijawab
   * dengan ISI LAPORAN HARIAN HARI INI — lengkap, rapi, dan bukan yang diminta.
   *
   * Register eksekutif justru imperatif. Karena itu niat ini ada bukan untuk
   * menjalankan perintahnya (produksi artefak tetap di Report Studio, dengan
   * review→setujui→beku yang memang tidak boleh dilewati dari WhatsApp),
   * melainkan supaya MARLIN MENGAKU tidak bisa dan menunjukkan jalannya —
   * jauh lebih berguna daripada menjawab pertanyaan yang tidak ditanyakan.
   */
  "produksi",
  /** "kamu bisa apa saja?" — MARLIN menjelaskan dirinya sendiri. */
  "bantuan",
] as const;
export type Niat = (typeof NIAT)[number];

export const NIAT_LABEL: Record<Niat, string> = {
  kendala: "kendala lapangan",
  kendala_dibuka: "kendala yang dibuka pada suatu periode",
  kendala_periode_terbuka: "kendala dari suatu periode yang masih terbuka",
  progress: "progress pekerjaan",
  deviasi: "deviasi terhadap kurva-S",
  kelengkapan: "kelengkapan laporan harian",
  laporan: "isi laporan harian satu tanggal",
  laporan_mingguan: "rekap mingguan (realisasi vs rencana per pekan)",
  laporan_bulanan: "rekap bulanan (realisasi vs rencana satu bulan)",
  rencana: "rencana kerja pekan ini atau pekan depan",
  produksi: "permintaan MEMBUAT atau MENGIRIM laporan/paparan/Excel/PDF",
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
  "niat": "kendala" | "progress" | "deviasi" | "kelengkapan" | "laporan" | "laporan_mingguan" | "laporan_bulanan" | "rencana" | "produksi" | "bantuan" | null,
  // "produksi" = penanya MEMERINTAHKAN membuat/mengirim artefak ("buatkan
  // laporan eksekutif", "export excel", "kirim pdf ke pak PPK") – bukan
  // bertanya. Pilih ini walau kata bendanya sama dengan niat lain; kata
  // KERJANYA yang menentukan.
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
  "- kendala     : masalah/hambatan/kendala yang MASIH TERBUKA sekarang",
  "- kendala_dibuka : kendala yang DIBUKA/MUNCUL pada periode tertentu, apa pun",
  "                   statusnya sekarang. Dipakai untuk 'kendala apa saja minggu lalu',",
  "                   'kendala yang muncul kemarin'.",
  "- kendala_periode_terbuka : kendala yang dibuka pada periode itu DAN masih",
  "                   terbuka sekarang. Dipakai untuk 'kendala minggu lalu yang belum",
  "                   selesai'.",
  "- progress    : kemajuan/realisasi pekerjaan, berapa persen, sudah sampai mana",
  "- deviasi     : keterlambatan, deviasi, siapa yang tertinggal dari jadwal",
  "- kelengkapan : siapa yang sudah/belum membuat laporan harian",
  "- laporan     : ISI laporan harian satu tanggal – apa yang dikerjakan, cuaca,",
  "                jam kerja, jumlah tenaga kerja, foto. Dipakai untuk permintaan",
  "                seperti 'minta laporan harian', 'laporan tanggal 12', 'kirim",
  "                laporan kemarin'.",
  "- laporan_mingguan : rekap satu PEKAN – realisasi vs rencana, berapa hari sudah",
  "                     dilaporkan. Dipakai untuk 'laporan mingguan', 'rekap mingguan',",
  "                     'laporan minggu lalu', 'progress mingguan'.",
  "                     PENTING: 'laporan MINGGUAN' selalu laporan_mingguan, JANGAN",
  "                     dipetakan ke 'laporan' (yang itu laporan HARIAN satu tanggal).",
  "- rencana     : RENCANA KERJA – apa yang AKAN dikerjakan, bukan yang sudah.",
  "                Dipakai untuk 'rencana minggu depan', 'rencana seminggu ke depan',",
  "                'apa yang perlu dikerjakan', 'pekerjaan apa untuk mengejar",
  "                progress', 'target minggu ini'. Satu-satunya niat yang menghadap",
  "                KE DEPAN – kalau pertanyaannya tentang yang akan datang, ini",
  "                jawabannya, JANGAN dipetakan ke progress atau laporan_mingguan.",
  "- bantuan     : penanya bertanya APA SAJA yang bisa kamu jawab / kamu bisa apa",
  "",
  "PERIODE – kamu HANYA melaporkan bentuk yang KAMU BACA. JANGAN menghitung tanggal.",
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
  "   Nama DAERAH ikut dihitung lokasi: desa, kecamatan, kabupaten, provinsi.",
  "   'apa jember kemarin laporan?' -> lokasiDisebut: [\"jember\"]. Pencocokannya",
  "   bukan tugasmu; MARLIN yang memutuskan itu kabupaten atau bukan.",
  "3. JANGAN pernah mengarang angka, tanggal, atau nama lokasi yang tidak ditulis penanya.",
  "4. Nama bulan/hari yang disebut penanya BUKAN nama lokasi.",
  "5. Bila riwayat percakapan diberikan, pakai HANYA untuk melengkapi bagian yang",
  "   dihilangkan dalam pertanyaan susulan. Pertanyaan terbaru selalu menang, dan",
  "   riwayat tidak boleh menambah lokasi yang tidak ditulis atau memperluas scope.",
].join("\n");

/* ------------------------------------------------------------------ */
/* Pencocokan nama lokasi                                              */
/* ------------------------------------------------------------------ */

/**
 * Katalog lokasi yang boleh disebut penanya.
 *
 * Wilayah administratif IKUT, dan itu bukan kelengkapan data belaka: orang
 * lapangan menyebut daerah, bukan hanya nama titik proyek. *"apa jember kemarin
 * laporan?"* dijawab "tidak menemukan lokasi: jember" selama katalog ini hanya
 * berisi `nama` — padahal Jember adalah kabupaten, dan lokasinya ada
 * (DECISIONS 367).
 *
 * Keempatnya WAJIB diisi (kecamatan boleh `null` karena memang opsional di DB).
 * Dibuat wajib, bukan opsional, supaya pembuat katalog baru tidak diam-diam
 * kehilangan kemampuan ini — gejalanya cuma "tidak ketemu", yang terbaca
 * seperti salah ketik penanya.
 */
export type LokasiKatalog = {
  id: string;
  nama: string;
  desa: string;
  kecamatan: string | null;
  kabupaten: string;
  provinsi: string;
  /**
   * Nama PERUSAHAAN pelaksana (vendor kontrak; sebelum kontrak, calon vendor
   * paket). Permintaan user 2026-08-26 – laporan lintas lokasi dibaca per
   * perusahaan lebih dulu, karena itulah yang ditagih.
   *
   * Opsional: katalog yang dirakit jalur lain (uji, pemeriksa niat) boleh
   * tidak tahu. Yang tidak tahu menulis "–" di dokumen, TIDAK menebak — salah
   * menuliskan perusahaan pada daftar kendala adalah tuduhan, bukan sekadar
   * kolom kosong.
   */
  pelaksana?: string | null;
};

export const TINGKAT_WILAYAH = ["desa", "kecamatan", "kabupaten", "provinsi"] as const;
export type TingkatWilayah = (typeof TINGKAT_WILAYAH)[number];

export const LABEL_TINGKAT: Record<TingkatWilayah, string> = {
  desa: "Desa",
  kecamatan: "Kecamatan",
  kabupaten: "Kabupaten",
  provinsi: "Provinsi",
};

/** Satu wilayah yang cocok, beserta seluruh lokasi di dalamnya. */
export type CocokWilayah = { tingkat: TingkatWilayah; nama: string; lokasi: LokasiKatalog[] };

export type HasilCocok =
  | { jenis: "tepat"; lokasi: LokasiKatalog }
  | { jenis: "wilayah"; wilayah: CocokWilayah }
  | { jenis: "ambigu"; kandidat: LokasiKatalog[] }
  | { jenis: "ambigu_wilayah"; pilihan: CocokWilayah[] }
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
 * Buang awalan jenis wilayah supaya "kabupaten jember" dan "jember" sama.
 *
 * Dipakai di KEDUA sisi: penanya menulis "kab. jember", sementara data bisa
 * menyimpan "Jember" polos (seperti sekarang) atau "Kabupaten Jember" kelak.
 * Tanpa ini, pencocokannya bergantung pada gaya pengetikan operator data.
 */
const AWALAN_WILAYAH = /^(kabupaten|kabupate|kab|kotamadya|kota|kecamatan|kec|provinsi|prov|kelurahan|kel|desa)\s+/;

export function normalWilayah(s: string): string {
  const n = normalNama(s);
  const tanpa = n.replace(AWALAN_WILAYAH, "").trim();
  // "kota" sendirian bukan awalan — ia bisa saja nama wilayahnya.
  return tanpa || n;
}

/**
 * Bentuk RAPAT — nama tanpa spasi sama sekali.
 *
 * Nama desa ditulis orang dengan dan tanpa spasi, dan keduanya sama benarnya:
 * "Randuputih" di basis data, "randu putih" yang diketik penanya. Sebelum ini
 * yang kedua TIDAK cocok dengan apa pun, lalu pertanyaannya jatuh ke jalur
 * catatan lapangan — dan dijawab dengan catatan lokasi LAIN, tanpa satu pun
 * tanda bahwa nama yang ia tulis tidak dikenali. Dilaporkan user 2026-08-20
 * dengan tangkapan layar: *"aku sengaja ketik randu putih … malah daerahnya
 * kemana-mana"*.
 *
 * Dipakai sebagai lapis TERAKHIR sebelum menyerah ke pencocokan wilayah, bukan
 * menggantikan pencocokan biasa: "batah timur" tetap harus lebih dulu dicoba
 * apa adanya.
 */
export function rapatNama(s: string): string {
  return normalNama(s).replace(/\s+/g, "");
}

/** Nilai wilayah satu lokasi pada satu tingkat. */
function nilaiWilayah(l: LokasiKatalog, t: TingkatWilayah): string | null {
  if (t === "desa") return l.desa;
  if (t === "kecamatan") return l.kecamatan;
  if (t === "kabupaten") return l.kabupaten;
  return l.provinsi;
}

/**
 * Cocokkan satu nama yang disebut penanya ke katalog lokasi.
 *
 * Berlapis dari yang paling pasti:
 *   1. nama lokasi sama persis (setelah dinormalkan)
 *   2. nama lokasi MENGANDUNG yang diketik ("kedung" → "Kedung Mutih")
 *   3. **nama WILAYAH** — desa, kecamatan, kabupaten, provinsi (DECISIONS 367)
 *
 * Nama lokasi menang lebih dulu karena ia yang paling khusus: kalau ada lokasi
 * bernama persis "Demak", itulah yang dimaksud, bukan seluruh Kabupaten Demak.
 *
 * Lapis 3 menghasilkan BANYAK lokasi, dan itu BUKAN keadaan ambigu — "Jember"
 * memang berarti seluruh lokasi di Jember. Yang ambigu adalah kalau satu kata
 * cocok di lebih dari satu TINGKAT dengan isi berbeda (mis. ada Kecamatan Demak
 * di dalam Kabupaten Demak): di situ MARLIN balik bertanya, karena memilih
 * sendiri menghasilkan jawaban yang benar untuk daerah yang salah.
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

  /*
   * Lapis RAPAT: spasi diabaikan sepenuhnya di kedua sisi.
   *
   * "randu putih" → "randuputih" = nama desa yang di basis data memang ditulis
   * menyatu. Dicoba SESUDAH pencocokan biasa supaya nama yang memang bespasi
   * tidak kalah oleh kebetulan.
   */
  const qr = rapatNama(diketik);
  if (qr) {
    const rapat = katalog.filter((l) => rapatNama(l.nama) === qr);
    if (rapat.length === 1) return { jenis: "tepat", lokasi: rapat[0] };
    if (rapat.length > 1) return { jenis: "ambigu", kandidat: rapat };

    const rapatSebagian = katalog.filter((l) => rapatNama(l.nama).includes(qr));
    if (rapatSebagian.length === 1) return { jenis: "tepat", lokasi: rapatSebagian[0] };
    if (rapatSebagian.length > 1) return { jenis: "ambigu", kandidat: rapatSebagian };
  }

  const w = normalWilayah(diketik);
  if (!w) return { jenis: "tidak_ada" };

  const pilihan: CocokWilayah[] = [];
  for (const tingkat of TINGKAT_WILAYAH) {
    const lokasi = katalog.filter((l) => {
      const v = nilaiWilayah(l, tingkat);
      return v != null && normalWilayah(v) === w;
    });
    if (lokasi.length === 0) continue;
    // Nama tampilan diambil dari DATA, bukan dari ketikan penanya — supaya
    // balasannya menyebut "Jember" seperti tertulis di sistem, bukan "jember".
    const nama = nilaiWilayah(lokasi[0], tingkat)!;
    pilihan.push({ tingkat, nama, lokasi });
  }
  if (pilihan.length === 0) return { jenis: "tidak_ada" };

  // Tingkat berbeda yang isinya PERSIS SAMA bukan pilihan sungguhan (desa
  // "Tengket" di kecamatan "Tengket" berisi satu lokasi yang sama). Ambil yang
  // paling khusus, jangan repotkan penanya dengan pertanyaan tanpa beda.
  const kunci = (c: CocokWilayah) =>
    c.lokasi
      .map((l) => l.id)
      .sort()
      .join("|");
  const unik = new Map<string, CocokWilayah>();
  for (const p of pilihan) if (!unik.has(kunci(p))) unik.set(kunci(p), p);

  const daftar = [...unik.values()];
  if (daftar.length === 1) {
    const satu = daftar[0];
    // Satu wilayah berisi satu lokasi = sama saja dengan menyebut lokasinya.
    if (satu.lokasi.length === 1) return { jenis: "tepat", lokasi: satu.lokasi[0] };
    return { jenis: "wilayah", wilayah: satu };
  }
  return { jenis: "ambigu_wilayah", pilihan: daftar };
}

/** Wilayah yang dipakai memperluas sasaran — WAJIB disebut di balasan. */
export type CatatanWilayah = {
  diketik: string;
  tingkat: TingkatWilayah;
  nama: string;
  jumlah: number;
};

export type HasilResolusi = {
  /** Lokasi yang berhasil dicocokkan tepat. */
  cocok: LokasiKatalog[];
  /**
   * Nama yang ternyata WILAYAH, bukan lokasi tunggal. Wajib tercetak di
   * balasan: menjawab 5 lokasi untuk pertanyaan yang menyebut satu kata, tanpa
   * mengatakan kata itu adalah kabupaten, membuat penanya mengira ia sedang
   * membaca angka satu lokasi.
   */
  wilayah: CatatanWilayah[];
  /** Nama yang ambigu, beserta kandidatnya — penanya harus ditanya balik. */
  ambigu: { diketik: string; kandidat: LokasiKatalog[] }[];
  /** Satu kata cocok di beberapa TINGKAT wilayah — juga harus ditanya balik. */
  ambiguWilayah: { diketik: string; pilihan: CocokWilayah[] }[];
  /** Nama yang tidak ada di katalog (atau di luar izin penanya). */
  tidakDikenal: string[];
};

/** Cocokkan seluruh nama yang disebut; kumpulkan yang bermasalah, jangan buang. */
export function resolusiLokasi(diketik: string[], katalog: LokasiKatalog[]): HasilResolusi {
  const hasil: HasilResolusi = {
    cocok: [],
    wilayah: [],
    ambigu: [],
    ambiguWilayah: [],
    tidakDikenal: [],
  };
  const sudah = new Set<string>();
  const tambah = (l: LokasiKatalog) => {
    if (sudah.has(l.id)) return;
    sudah.add(l.id);
    hasil.cocok.push(l);
  };

  for (const nama of diketik) {
    const c = cocokkanLokasi(nama, katalog);
    if (c.jenis === "tepat") {
      tambah(c.lokasi);
    } else if (c.jenis === "wilayah") {
      for (const l of c.wilayah.lokasi) tambah(l);
      hasil.wilayah.push({
        diketik: nama,
        tingkat: c.wilayah.tingkat,
        nama: c.wilayah.nama,
        jumlah: c.wilayah.lokasi.length,
      });
    } else if (c.jenis === "ambigu") {
      hasil.ambigu.push({ diketik: nama, kandidat: c.kandidat });
    } else if (c.jenis === "ambigu_wilayah") {
      hasil.ambiguWilayah.push({ diketik: nama, pilihan: c.pilihan });
    } else {
      hasil.tidakDikenal.push(nama);
    }
  }
  return hasil;
}
