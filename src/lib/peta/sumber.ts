import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { isR2Configured, r2Exists, r2PresignGet } from "@/lib/r2";
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
   * DI LINGKUNGAN UJI, PETA DIMATIKAN — dan itu keputusan, bukan jalan pintas.
   *
   * Uji E2E yang mengunduh ubin dari CDN pihak ketiga adalah uji yang memerah
   * ketika server orang lain sedang lambat: kegagalannya tidak mengatakan apa
   * pun tentang MARLIN. Terbukti mahal 2026-09-06 — begitu peta dipasang,
   * lamanya E2E melonjak dari belasan menit jadi lebih dari empat puluh, tanpa
   * satu pun tes menguji peta itu sendiri.
   *
   * Yang hilang di uji hanya GAMBARNYA; layarnya tetap dirender lengkap dengan
   * pesan "peta dasar belum tersedia", dan justru keadaan itulah yang paling
   * pantas diuji: pengguna sungguhan akan melihatnya setiap kali berkas peta
   * dasar belum terpasang.
   */
  if (env.APP_ENV === "test") return { pmtiles: null, satelit: null, satelitAtribusi: null };

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
