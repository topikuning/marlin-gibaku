import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { DIR_PETA, periksaBasemap, unduhanBerjalan } from "./berkas";
import type { SumberPeta } from "./gaya";

/**
 * DARI MANA PETA MENGAMBIL UBINNYA — dijawab di server, bukan di komponen.
 *
 * Dua hal yang membuatnya harus di sini:
 *
 * 1. **Peta dasar milik sendiri, di volume lingkungan ini.** Berkas `.pmtiles`
 *    duduk di disk (lihat `berkas.ts`) dan disajikan lewat jalur ber-sesi yang
 *    paham permintaan Range — peramban menarik potongan yang dilihat saja,
 *    bukan berkas ratusan MB itu utuh. Bukan di penyimpanan objek: R2 dev dan
 *    produksi berbeda, jadi satu berkas di sana hanya akan melayani salah
 *    satunya (teguran user 2026-09-06).
 * 2. **Ketidakhadirannya harus terbaca.** Selama berkas itu belum ada,
 *    `pmtiles` bernilai null dan layar mengatakannya. Peta yang kehilangan
 *    sumbernya lalu menampilkan kanvas kosong akan terbaca sebagai "tidak ada
 *    lokasi" — kesalahan baca yang jauh lebih mahal daripada peta yang mati
 *    terang-terangan.
 */

/**
 * Citra satelit bawaan: World Imagery milik Esri, dipakai luas dan bisa diganti
 * lewat `PETA_SATELIT_URL`. Atribusinya WAJIB tampil — itu syarat pemakaian,
 * bukan hiasan; komponen menampilkannya lewat kendali atribusi MapLibre.
 */
const SATELIT_BAWAAN =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELIT_ATRIBUSI_BAWAAN = "Citra: Esri, Maxar, Earthstar Geographics";

export const sumberPeta = cache(async (): Promise<SumberPeta> => {
  /*
   * PETA DIMATIKAN HANYA SAAT UJI E2E BERJALAN — bukan berdasarkan APP_ENV.
   *
   * Versi pertama (2026-09-06) memakai `APP_ENV === "test"`, dan itu SALAH:
   * `APP_ENV` menandai LINGKUNGAN, bukan "sedang menjalankan uji". Lingkungan
   * dev memakai nilai yang sama, jadi petanya ikut mati justru di tempat yang
   * dipakai orang untuk MEMERIKSA apakah petanya bekerja — teguran user pada
   * hari yang sama, dan teguran yang benar.
   *
   * Sekarang penandanya khusus dan sengaja tidak dipakai untuk apa pun selain
   * ini: `PETA_MATI=1`, diset HANYA oleh job E2E di CI. Alasan mematikannya
   * tetap sama — uji yang mengunduh ubin dari CDN pihak ketiga akan memerah
   * ketika server orang lain sedang lambat, dan lamanya E2E sempat melonjak
   * dari belasan menit jadi lebih dari empat puluh tanpa satu pun tes menguji
   * peta itu sendiri.
   */
  if (env.PETA_MATI === "1") return { pmtiles: null, satelit: null, satelitAtribusi: null };

  const satelitUrl = env.PETA_SATELIT_URL?.trim() || SATELIT_BAWAAN;
  const satelit = satelitUrl.toLowerCase() === "mati" ? null : satelitUrl;

  // Disajikan dari volume lewat jalur ber-sesi yang paham Range — lihat
  // `app/api/peta/basemap`.
  const berkas = await periksaBasemap();
  const pmtiles = berkas.ada ? "/api/peta/basemap" : null;

  return {
    pmtiles,
    satelit,
    satelitAtribusi: satelit
      ? env.PETA_SATELIT_ATRIBUSI?.trim() || SATELIT_ATRIBUSI_BAWAAN
      : null,
  };
});

/** Keadaan sumber peta untuk layar /sistem — jawaban "sudah beres atau belum". */
export type StatusPeta = {
  siap: boolean;
  /** Peta dasar vektor (.pmtiles di volume lingkungan ini). */
  dasar: {
    ada: boolean;
    /** Direktori tempat berkasnya duduk — disebut supaya bisa diperiksa orang. */
    lokasi: string;
    ukuranMb: number | null;
    diperbarui: Date | null;
    sedangUnduh: boolean;
    sebab: string;
  };
  satelit: { ada: boolean; sumber: string | null; atribusi: string | null };
  dimatikan: boolean;
};

/**
 * Kenapa ini ada: teguran user 2026-09-06 — *"tahu darimana aku kalau itu
 * beneran sudah beres atau belum. kasih instruksi yang jelas!"*
 *
 * Selama keadaan peta cuma bisa diketahui dengan membuka peta lalu menebak
 * kenapa kosong, setiap orang yang memasangnya harus bertanya ke pembuatnya.
 * Di sini keadaannya disebut apa adanya, berikut SEBABNYA bila belum siap.
 */
export async function statusPeta(): Promise<StatusPeta> {
  const dimatikan = env.PETA_MATI === "1";
  const satelitUrl = env.PETA_SATELIT_URL?.trim() || SATELIT_BAWAAN;
  const satelitHidup = !dimatikan && satelitUrl.toLowerCase() !== "mati";

  const berkas = await periksaBasemap();
  let sebab = "";
  if (dimatikan) {
    sebab = "Peta sengaja dimatikan lewat PETA_MATI=1 (dipakai job E2E di CI).";
  } else if (!berkas.ada) {
    sebab = unduhanBerjalan()
      ? "Sedang diunduh ke volume – muat ulang halaman ini beberapa menit lagi."
      : `Belum ada di ${DIR_PETA}. Tekan "Unduh peta dasar" di kartu ini; sekali saja, dan hasilnya tinggal di volume lingkungan ini.`;
  }

  return {
    siap: berkas.ada || satelitHidup,
    dasar: {
      ada: berkas.ada,
      lokasi: DIR_PETA,
      ukuranMb: berkas.ada ? Math.round((berkas.ukuran / 1024 / 1024) * 10) / 10 : null,
      diperbarui: berkas.diperbarui,
      sedangUnduh: unduhanBerjalan(),
      sebab,
    },
    satelit: {
      ada: satelitHidup,
      sumber: satelitHidup ? satelitUrl : null,
      atribusi: satelitHidup ? env.PETA_SATELIT_ATRIBUSI?.trim() || SATELIT_ATRIBUSI_BAWAAN : null,
    },
    dimatikan,
  };
}
