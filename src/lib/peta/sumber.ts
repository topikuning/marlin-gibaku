import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { isR2Configured, r2Exists, r2Info, r2PresignGet } from "@/lib/r2";
import type { SumberPeta } from "./gaya";

/**
 * DARI MANA PETA MENGAMBIL UBINNYA — dijawab di server, bukan di komponen.
 *
 * Dua hal yang membuatnya harus di sini:
 *
 * 1. **Peta dasar milik sendiri.** Berkas `.pmtiles` disimpan di R2 yang sudah
 *    kita bayar: tanpa kunci API, tanpa kuota, tanpa pihak ketiga yang bisa
 *    memblokir peta proyek pemerintah di tengah jalan. Bucketnya tertutup, jadi
 *    peramban tidak bisa menariknya langsung — server yang menandatangani URL
 *    berbatas waktu, lalu peramban membaca potongan berkasnya sendiri
 *    (permintaan Range). Yang mengalir cuma potongan yang benar-benar dilihat,
 *    bukan seluruh berkas.
 * 2. **Ketidakhadirannya harus terbaca.** Selama berkas itu belum diunggah,
 *    `pmtiles` bernilai null dan layar mengatakannya. Peta yang kehilangan
 *    sumbernya lalu menampilkan kanvas kosong akan terbaca sebagai "tidak ada
 *    lokasi" — kesalahan baca yang jauh lebih mahal daripada peta yang mati
 *    terang-terangan.
 */

/** Kunci objek peta dasar di R2. */
const KUNCI_PMTILES = env.PETA_PMTILES_KEY?.trim() || "peta/basemap.pmtiles";

/**
 * Citra satelit bawaan: World Imagery milik Esri, dipakai luas dan bisa diganti
 * lewat `PETA_SATELIT_URL`. Atribusinya WAJIB tampil — itu syarat pemakaian,
 * bukan hiasan; komponen menampilkannya lewat kendali atribusi MapLibre.
 */
const SATELIT_BAWAAN =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELIT_ATRIBUSI_BAWAAN = "Citra: Esri, Maxar, Earthstar Geographics";

/**
 * URL bertanda-tangan berlaku 6 jam: cukup panjang untuk satu sesi kerja penuh
 * (peta dibuka pagi, ditutup sore) tanpa menjadi tautan yang praktis abadi bila
 * URL-nya tersalin ke luar.
 */
const UMUR_TANDA_TANGAN = 6 * 60 * 60;

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

  let pmtiles: string | null = null;
  if (isR2Configured() && (await r2Exists(KUNCI_PMTILES))) {
    pmtiles = await r2PresignGet(KUNCI_PMTILES, UMUR_TANDA_TANGAN);
  }

  return {
    pmtiles,
    satelit,
    satelitAtribusi: satelit
      ? env.PETA_SATELIT_ATRIBUSI?.trim() || SATELIT_ATRIBUSI_BAWAAN
      : null,
  };
});

/** Kunci objek yang dipakai — dibaca skrip pembuat peta dasar & halaman sistem. */
export const kunciPmtiles = KUNCI_PMTILES;

/** Keadaan sumber peta untuk layar /sistem — jawaban "sudah beres atau belum". */
export type StatusPeta = {
  siap: boolean;
  /** Peta dasar vektor (.pmtiles di R2). */
  dasar: { ada: boolean; kunci: string; ukuranMb: number | null; diperbarui: Date | null; sebab: string };
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

  let ada = false;
  let ukuranMb: number | null = null;
  let diperbarui: Date | null = null;
  let sebab = "";
  if (dimatikan) {
    sebab = "Peta sengaja dimatikan lewat PETA_MATI=1 (dipakai job E2E di CI).";
  } else if (!isR2Configured()) {
    sebab = "R2 belum dikonfigurasi di server ini (R2_ENDPOINT dkk kosong).";
  } else {
    const info = await r2Info(KUNCI_PMTILES);
    if (info) {
      ada = true;
      ukuranMb = Math.round((info.size / 1024 / 1024) * 10) / 10;
      diperbarui = info.lastModified;
    } else {
      sebab = `Berkas ${KUNCI_PMTILES} belum ada di R2. Jalankan workflow "Peta dasar MARLIN" di tab Actions (sekali saja; hasilnya dipakai tanpa deploy ulang).`;
    }
  }

  return {
    siap: ada || satelitHidup,
    dasar: { ada, kunci: KUNCI_PMTILES, ukuranMb, diperbarui, sebab },
    satelit: {
      ada: satelitHidup,
      sumber: satelitHidup ? satelitUrl : null,
      atribusi: satelitHidup ? env.PETA_SATELIT_ATRIBUSI?.trim() || SATELIT_ATRIBUSI_BAWAAN : null,
    },
    dimatikan,
  };
}
