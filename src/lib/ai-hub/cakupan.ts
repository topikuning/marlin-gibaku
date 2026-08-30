import { LABEL_WILAYAH, type WilayahAdapter } from "./adapters-pagar";
import { NIAT, type Niat } from "@/lib/waha/tanya-niat";

/**
 * PETA CAKUPAN AI — apa saja yang bisa ditanyakan, dan lewat jalur mana.
 *
 * ### Kenapa berkas ini ada
 *
 * Permintaan user 2026-08-28: *"pastikan semua hal yang ada di marlin bisa
 * ditanyakan secara jelas di ai (kecuali keuangan), artinya kamu harus
 * memastikan semua hal terkait kendala, progress, semuanya terkait pekerjaan
 * bisa dihandle dan ditanyakan di AI."*
 *
 * "Sudah kupastikan" tanpa daftar adalah janji, bukan jaminan. Wilayah baru
 * lahir terus (temuan & verifikasi di DECISIONS 426, rencana kerja di 458), dan
 * tiap kali itu terjadi ia sunyi: halamannya jadi, datanya jadi, tetapi tidak
 * ada apa pun yang mengingatkan bahwa AI belum bisa menjawabnya. Cacat yang
 * persis begitu yang membuat *"pekerjaan apa yang perlu dilakukan untuk
 * mengejar progress?"* dijawab "tidak punya angka bersumber".
 *
 * Karena itu cakupannya DIDAFTAR di sini, dan `tests/unit/ai-cakupan.test.ts`
 * menegakkan dua arah sekaligus:
 *
 *   1. tiap wilayah yang didaftar benar-benar punya jalur (niat WA / adapter);
 *   2. tiap niat & tiap adapter yang ADA benar-benar terdaftar di sini.
 *
 * Arah kedua itu yang menangkap wilayah baru: menambah adapter tanpa
 * mencantumkannya di sini akan MEMERAHKAN uji, dan penulisnya dipaksa
 * memutuskan — dijawab AI, atau ditulis alasannya kenapa tidak.
 *
 * ### Dua jalur, dan bedanya berarti
 *
 * - **niat** = jalur CEPAT WhatsApp: dijawab tanpa memanggil provider sama
 *   sekali, jadi tetap hidup saat AI mati dan tidak memakan kuota.
 * - **adapter** = fakta yang disuntikkan ke jalur BEBAS (Ask MARLIN dan
 *   tanya-bebas WhatsApp memakai `buildAdapterFacts` yang sama). Pertanyaannya
 *   boleh berbentuk apa pun; model merangkai dari fakta yang sudah dipagari.
 * - **pulse** = fakta inti `buildPortfolioPulse` yang selalu ikut tanpa
 *   kapabilitas tambahan.
 *
 * Wilayah yang punya keduanya paling kuat: pertanyaan lazimnya dijawab
 * seketika, pertanyaan tak terduga tetap terjawab lewat model.
 */

export type JalurJawab =
  /** Niat deterministik WhatsApp — tanpa provider AI. */
  | { jenis: "niat"; niat: Niat[] }
  /** Fakta inti portfolio pulse (selalu ikut). */
  | { jenis: "pulse"; sourceRefSuffix: string }
  /** Adapter berkapabilitas — masuk ke Ask MARLIN & tanya-bebas WA. */
  | { jenis: "adapter"; wilayah: WilayahAdapter };

export type WilayahCakupan = {
  /** Nama wilayah sebagaimana dikenal user, bukan nama tabel. */
  nama: string;
  /** Halaman MARLIN yang memuatnya — supaya daftar ini bisa diperiksa mata. */
  halaman: string;
  /**
   * RUTE HALAMAN di `src/app/(app)/` yang wilayah ini layani — jalur PENUH
   * relatif terhadap `(app)`, mis. `lokasi/[slug]/progress`.
   *
   * Ini yang membuat peta ini tidak bisa ketinggalan zaman diam-diam: ujinya
   * membaca tiap direktori ber-`page.tsx` yang SUNGGUHAN ada dan menuntut
   * masing-masing punya rumah — di sini, atau di `RUTE_BUKAN_WILAYAH` berikut
   * alasannya.
   *
   * Jalur PENUH, bukan segmen pertama (review kedua 2026-08-28): versi pertama
   * hanya membaca direktori tingkat satu, sehingga halaman baru di bawah
   * `lokasi/[slug]/…` atau `paket/[id]/…` otomatis dianggap tercakup oleh
   * entri "lokasi"/"paket" — padahal domain datanya sama sekali lain. Jaminan
   * yang tertulis di komentar ini tidak berlaku untuk justru dua tempat yang
   * paling sering ditambahi halaman.
   *
   * Akhiran `/*` mencakup seluruh subpohon, dan itu KEPUTUSAN yang harus
   * disebut: `lokasi/[slug]/rab/*` berarti "apa pun di bawah RAB adalah RAB".
   * Menuliskannya membuat keputusan itu terlihat di peta, bukan tersembunyi di
   * dalam uji.
   */
  rute: string[];
  jalur: JalurJawab[];
  /**
   * Terisi = wilayah ini SENGAJA tidak dijawab AI, berikut alasannya.
   * Kosong = harus punya minimal satu jalur.
   */
  lewatSengaja?: string;
};

export const CAKUPAN_AI: WilayahCakupan[] = [
  {
    nama: "Progress pekerjaan & deviasi kurva-S",
    halaman: "/progress, /lokasi/[slug]/progress",
    rute: ["progress", "lokasi", "lokasi/[slug]", "lokasi/[slug]/progress"],
    jalur: [
      { jenis: "niat", niat: ["progress", "deviasi", "laporan_mingguan", "laporan_bulanan"] },
      { jenis: "pulse", sourceRefSuffix: "progress" },
    ],
  },
  {
    nama: "Laporan harian (isi & kelengkapan)",
    halaman: "/laporan/status-harian, /lokasi/[slug]/laporan-lokasi",
    rute: ["laporan/*", "hari-ini", "lokasi/[slug]/harian/*", "lokasi/[slug]/laporan-lokasi"],
    jalur: [
      { jenis: "niat", niat: ["laporan", "kelengkapan"] },
      { jenis: "pulse", sourceRefSuffix: "laporan" },
    ],
  },
  {
    nama: "Kendala lapangan & tindak lanjut (recovery)",
    halaman: "/kendala",
    rute: ["kendala"],
    jalur: [
      { jenis: "niat", niat: ["kendala", "kendala_dibuka", "kendala_periode_terbuka"] },
      { jenis: "pulse", sourceRefSuffix: "kendala" },
    ],
  },
  {
    /*
     * Bukan wilayah data baru — ia BENTUK BACA atas dua wilayah di atasnya
     * (kendala dan kegiatan lapangan). Didaftar tersendiri karena yang
     * ditanyakan berbeda: bukan "apa yang terbuka" melainkan "apa yang terjadi,
     * berurutan, dan lokasi ini sekarang berdiri di mana". Permintaan user
     * 2026-08-31.
     */
    nama: "Kronologi lokasi (kendala + kegiatan lapangan, berurutan)",
    halaman: "/ai/kronologi",
    rute: ["ai/kronologi"],
    jalur: [{ jenis: "niat", niat: ["kronologi"] }],
  },
  {
    nama: "Rencana kerja mingguan (yang AKAN dikerjakan)",
    halaman: "/lokasi/[slug]/rab (formulir rencana mingguan)",
    rute: [],
    jalur: [
      { jenis: "niat", niat: ["rencana"] },
      { jenis: "pulse", sourceRefSuffix: "rencana" },
    ],
  },
  {
    nama: "Dokumentasi foto & kegiatan lapangan",
    halaman: "/foto, /aktivitas",
    rute: ["foto/*", "foto-cepat", "aktivitas", "peta", "lokasi/[slug]/kegiatan"],
    jalur: [{ jenis: "pulse", sourceRefSuffix: "foto" }],
  },
  {
    nama: "Kontrak & masa pelaksanaan",
    halaman: "/paket/[id]",
    rute: ["paket/*"],
    jalur: [{ jenis: "adapter", wilayah: "kontrak" }],
  },
  {
    nama: "RAB & revisinya",
    halaman: "/lokasi/[slug]/rab",
    rute: ["lokasi/[slug]/rab/*"],
    jalur: [{ jenis: "adapter", wilayah: "rab" }],
  },
  {
    nama: "Milestone administrasi & kelengkapan dokumen KKP",
    halaman: "/dokumen, /lokasi/[slug]/administrasi",
    rute: ["dokumen/*", "lokasi/[slug]/dokumen"],
    jalur: [{ jenis: "adapter", wilayah: "milestone" }],
  },
  {
    nama: "Temuan pemeriksa",
    halaman: "/temuan",
    rute: ["temuan/*"],
    jalur: [{ jenis: "adapter", wilayah: "temuan" }],
  },
  {
    nama: "Kesiapan termin / PHO / FHO",
    halaman: "/kesiapan",
    rute: ["kesiapan"],
    jalur: [{ jenis: "adapter", wilayah: "kesiapan" }],
  },
  {
    nama: "Peringatan dini (perlu tindakan)",
    halaman: "/perlu-tindakan",
    rute: ["perlu-tindakan"],
    jalur: [{ jenis: "adapter", wilayah: "ews" }],
  },
  {
    nama: "Verifikasi eksternal laporan oleh Wakil PPK",
    halaman: "/verifikasi",
    rute: ["verifikasi/*"],
    jalur: [{ jenis: "adapter", wilayah: "verifikasi" }],
  },
  {
    nama: "Inspeksi lapangan",
    halaman: "/verifikasi (tab inspeksi)",
    rute: [],
    jalur: [{ jenis: "adapter", wilayah: "inspeksi" }],
  },
  {
    nama: "Persuratan resmi & utang jawab",
    halaman: "/surat",
    rute: ["surat"],
    jalur: [{ jenis: "adapter", wilayah: "surat" }],
  },
  {
    nama: "Keuangan (uang internal pelaksana)",
    halaman: "/keuangan",
    rute: ["keuangan", "lokasi/[slug]/keuangan"],
    // Adapternya ADA dan tetap dipagari `finance.view`; yang sengaja tidak
    // dibuat adalah jalur cepat WhatsApp. Permintaan user 2026-08-28
    // mengecualikan keuangan, dan pagarnya sendiri sudah lebih ketat daripada
    // wilayah lain (`wakil_ppk` sengaja dijauhkan, `site_manager` hanya
    // `finance.input`).
    jalur: [{ jenis: "adapter", wilayah: "keuangan" }],
    lewatSengaja:
      "Dikecualikan user 2026-08-28. Faktanya tetap ada di adapter dan tetap dipagari finance.view; yang tidak dibuat adalah niat WhatsApp-nya.",
  },
];

/**
 * Rute `(app)` yang memang BUKAN wilayah data pekerjaan — berikut alasannya.
 *
 * Daftar ini sengaja menuntut alasan tertulis, bukan sekadar nama: "kenapa
 * halaman ini tidak bisa ditanyakan ke AI" adalah pertanyaan yang pantas
 * dijawab sekali, di tempat yang terbaca, daripada ditanyakan ulang tiap kali
 * ada yang memeriksa.
 */
export const RUTE_BUKAN_WILAYAH: Record<string, string> = {
  ".": "Command center – ringkasan lintas wilayah; tiap angkanya sudah punya rumahnya sendiri di bawah.",
  "ai/*": "Permukaan Ask MARLIN itu sendiri – bukan data yang ditanyakan.",
  "chat-grup/*": "Arsip percakapan WhatsApp; isinya masuk AI lewat pencarian narasi, bukan sebagai wilayah fakta.",
  "kontak-wa": "Pengaturan kanal WhatsApp – konfigurasi, bukan data pekerjaan.",
  lampiran: "Kurasi lampiran WhatsApp masuk – tahap sebelum data jadi dokumen/laporan.",
  "laporan-wa": "Riwayat kiriman WhatsApp – jejak pengiriman, bukan keadaan pekerjaan.",
  "master/*": "Basis AHSP & katalog master: data acuan nasional, bukan keadaan satu pekerjaan.",
  pengguna: "Administrasi akun – di luar lingkup pekerjaan lapangan.",
  "sistem/*": "Pengaturan aplikasi – di luar lingkup pekerjaan lapangan.",
  "lokasi/[slug]/rapl":
    "RAPL: kebutuhan & biaya bahan/upah hasil analisis AHSP. Formulanya kanonik " +
    "(`ahsp/rapl-calc.ts`) tetapi belum punya jalur AI, dan menjawabnya setengah " +
    "jadi lebih buruk daripada mengaku belum bisa.",
};

/**
 * Niat yang memang bukan wilayah data — tidak perlu masuk peta cakupan.
 *
 * `produksi` masuk sini bukan karena terlupakan, melainkan karena ia PERINTAH,
 * bukan pertanyaan: penanya meminta artefak, dan artefak resmi lahir di Report
 * Studio lewat review→setujui→beku (DECISIONS 193), bukan dari WhatsApp.
 * Niatnya tetap ada supaya perintah semacam itu dikenali dan dijawab jujur,
 * alih-alih salah dipetakan jadi pertanyaan lain (audit 2026-08-28).
 */
export const NIAT_BUKAN_DATA: Niat[] = ["bantuan", "produksi"];

/** Seluruh niat yang dipakai peta cakupan. */
export function niatTercakup(): Set<Niat> {
  const out = new Set<Niat>();
  for (const w of CAKUPAN_AI) {
    for (const j of w.jalur) if (j.jenis === "niat") for (const n of j.niat) out.add(n);
  }
  return out;
}

/** Seluruh wilayah adapter yang dipakai peta cakupan. */
export function adapterTercakup(): Set<WilayahAdapter> {
  const out = new Set<WilayahAdapter>();
  for (const w of CAKUPAN_AI) {
    for (const j of w.jalur) if (j.jenis === "adapter") out.add(j.wilayah);
  }
  return out;
}

/** Niat yang ADA di sistem tetapi belum tercantum di peta cakupan. */
export function niatBelumTerdaftar(): Niat[] {
  const dipakai = niatTercakup();
  return NIAT.filter((n) => !dipakai.has(n) && !NIAT_BUKAN_DATA.includes(n));
}

/** Rute yang sudah punya rumah — di peta cakupan atau di daftar pengecualian. */
export function ruteTercakup(): Set<string> {
  const out = new Set<string>(Object.keys(RUTE_BUKAN_WILAYAH));
  for (const w of CAKUPAN_AI) for (const r of w.rute) out.add(r);
  return out;
}

/**
 * Apakah satu rute halaman punya rumah di peta?
 *
 * Cocok PERSIS, atau berada di bawah pola ber-`/*`. Dipakai uji cakupan, dan
 * ditaruh di sini — bukan di dalam uji — supaya aturannya bisa dibaca bersama
 * petanya.
 */
export function rutePunyaRumah(rute: string, pola: Iterable<string>): boolean {
  for (const p of pola) {
    if (p === rute) return true;
    if (p.endsWith("/*")) {
      const akar = p.slice(0, -2);
      if (rute === akar || rute.startsWith(`${akar}/`)) return true;
    }
  }
  return false;
}

/** Wilayah adapter yang ADA tetapi belum tercantum di peta cakupan. */
export function adapterBelumTerdaftar(): WilayahAdapter[] {
  const dipakai = adapterTercakup();
  return (Object.keys(LABEL_WILAYAH) as WilayahAdapter[]).filter((w) => !dipakai.has(w));
}
