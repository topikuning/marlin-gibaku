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
    jalur: [
      { jenis: "niat", niat: ["progress", "deviasi", "laporan_mingguan"] },
      { jenis: "pulse", sourceRefSuffix: "progress" },
    ],
  },
  {
    nama: "Laporan harian (isi & kelengkapan)",
    halaman: "/laporan/status-harian, /lokasi/[slug]/laporan-lokasi",
    jalur: [
      { jenis: "niat", niat: ["laporan", "kelengkapan"] },
      { jenis: "pulse", sourceRefSuffix: "laporan" },
    ],
  },
  {
    nama: "Kendala lapangan & tindak lanjut (recovery)",
    halaman: "/kendala",
    jalur: [
      { jenis: "niat", niat: ["kendala", "kendala_dibuka", "kendala_periode_terbuka"] },
      { jenis: "pulse", sourceRefSuffix: "kendala" },
    ],
  },
  {
    nama: "Rencana kerja mingguan (yang AKAN dikerjakan)",
    halaman: "/lokasi/[slug]/rab (formulir rencana mingguan)",
    jalur: [
      { jenis: "niat", niat: ["rencana"] },
      { jenis: "pulse", sourceRefSuffix: "rencana" },
    ],
  },
  {
    nama: "Dokumentasi foto & kegiatan lapangan",
    halaman: "/foto, /aktivitas",
    jalur: [{ jenis: "pulse", sourceRefSuffix: "foto" }],
  },
  {
    nama: "Kontrak & masa pelaksanaan",
    halaman: "/paket/[id]",
    jalur: [{ jenis: "adapter", wilayah: "kontrak" }],
  },
  {
    nama: "RAB & revisinya",
    halaman: "/lokasi/[slug]/rab",
    jalur: [{ jenis: "adapter", wilayah: "rab" }],
  },
  {
    nama: "Milestone administrasi & kelengkapan dokumen KKP",
    halaman: "/dokumen, /lokasi/[slug]/administrasi",
    jalur: [{ jenis: "adapter", wilayah: "milestone" }],
  },
  {
    nama: "Temuan pemeriksa",
    halaman: "/temuan",
    jalur: [{ jenis: "adapter", wilayah: "temuan" }],
  },
  {
    nama: "Kesiapan termin / PHO / FHO",
    halaman: "/kesiapan",
    jalur: [{ jenis: "adapter", wilayah: "kesiapan" }],
  },
  {
    nama: "Peringatan dini (perlu tindakan)",
    halaman: "/perlu-tindakan",
    jalur: [{ jenis: "adapter", wilayah: "ews" }],
  },
  {
    nama: "Verifikasi eksternal laporan oleh Wakil PPK",
    halaman: "/verifikasi",
    jalur: [{ jenis: "adapter", wilayah: "verifikasi" }],
  },
  {
    nama: "Inspeksi lapangan",
    halaman: "/verifikasi (tab inspeksi)",
    jalur: [{ jenis: "adapter", wilayah: "inspeksi" }],
  },
  {
    nama: "Persuratan resmi & utang jawab",
    halaman: "/surat",
    jalur: [{ jenis: "adapter", wilayah: "surat" }],
  },
  {
    nama: "Keuangan (uang internal pelaksana)",
    halaman: "/keuangan",
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

/** Niat yang memang bukan wilayah data — tidak perlu masuk peta cakupan. */
export const NIAT_BUKAN_DATA: Niat[] = ["bantuan"];

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

/** Wilayah adapter yang ADA tetapi belum tercantum di peta cakupan. */
export function adapterBelumTerdaftar(): WilayahAdapter[] {
  const dipakai = adapterTercakup();
  return (Object.keys(LABEL_WILAYAH) as WilayahAdapter[]).filter((w) => !dipakai.has(w));
}
