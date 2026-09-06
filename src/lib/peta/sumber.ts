import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { DIR_PETA, isiBasemapTerkini, periksaBasemap, unduhanBerjalan } from "./berkas";
import { lapisanDiminta, type SumberPeta } from "./gaya";
import { skemaCocok } from "./pmtiles";

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

/**
 * Kenapa berkas peta dasar yang terpasang TIDAK bisa digambar — string kosong
 * berarti tidak ada halangan, null berarti berkasnya memang belum ada.
 *
 * Satu tempat untuk tiga penyebab peta abu-abu, dipakai `sumberPeta()` (untuk
 * menolak menyerahkannya ke peramban) dan `statusPeta()` (untuk mengatakannya).
 */
async function halanganDasar(): Promise<string | null> {
  const isi = await isiBasemapTerkini();
  if (!isi) return null;
  if (!isi.sah) return `Berkasnya ada, tapi ${isi.sebab}`;
  if (isi.kepala.jenisUbin !== "vektor")
    return `Ubinnya ${isi.kepala.jenisUbin}, bukan vektor – gaya peta dasar hanya bisa menggambar ubin vektor, jadi petanya akan abu-abu. Ganti berkasnya dengan ekstrak Protomaps.`;
  /*
   * Batas wilayah yang tidak sah membuat MapLibre tidak meminta SATU pun ubin —
   * dan pmtiles cuma membisikkannya ke console peramban. Hasil di layar: peta
   * abu-abu yang tidak mengaku salah apa-apa.
   */
  const [barat, selatan, timur, utara] = isi.kepala.batas;
  if (!(barat < timur && selatan < utara))
    return `Batas wilayah di kepala arsipnya tidak sah (${barat},${selatan} – ${timur},${utara}). Dengan batas seperti itu peramban tidak meminta satu ubin pun dan petanya abu-abu. Bangun ulang arsipnya dengan bbox yang benar.`;
  const diminta = lapisanDiminta();
  if (!skemaCocok(isi.lapisan, diminta))
    return `Skema lapisannya bukan Protomaps. Arsip ini berisi ${isi.lapisan.slice(0, 6).join(", ") || "(tanpa daftar lapisan)"}, sedangkan gaya meminta ${diminta.slice(0, 6).join(", ")}. Tidak ada satu pun yang cocok, jadi petanya abu-abu meski berkasnya sehat. Pakai berkas .pmtiles bikinan Protomaps (build.protomaps.com atau workflow "Peta dasar MARLIN").`;
  return "";
}

async function bisaDigambar(): Promise<boolean> {
  return (await halanganDasar()) === "";
}

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

  /*
   * Disajikan dari volume lewat jalur ber-sesi yang paham Range — lihat
   * `app/api/peta/basemap`.
   *
   * Berkas yang ADA tapi tidak bisa digambar (bukan PMTiles, ubinnya raster,
   * skemanya bukan Protomaps) diperlakukan sebagai TIDAK ADA di sini. Alasannya
   * keluhan user 2026-09-06: menyerahkannya ke peramban menghasilkan kanvas
   * abu-abu yang terbaca sebagai aplikasi rusak; menolaknya membuat peta jatuh
   * ke citra satelit dan mengatakan apa yang kurang. Sebab lengkapnya ada di
   * layar /sistem.
   */
  const pmtiles = (await bisaDigambar()) ? "/api/peta/basemap" : null;

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
    /**
     * Isi berkasnya — jawaban atas "berkasnya ada, kenapa petanya abu-abu".
     * Null selama berkasnya memang belum ada.
     */
    isi: {
      /** Berkepala PMTiles v3 yang bisa dibaca? */
      sah: boolean;
      /** Vektor / png / … — gaya ini hanya bisa menggambar yang vektor. */
      jenisUbin: string | null;
      zoom: string | null;
      /** Kotak wilayah yang dicakup arsip — supaya "kenapa kosong di sini" terjawab. */
      wilayah: string | null;
      /** Nama lapisan di arsip yang juga diminta gaya (irisan). */
      lapisanCocok: number;
      lapisanArsip: number;
      /** Kosong = tidak ada masalah yang bisa dilihat dari berkasnya. */
      masalah: string;
    } | null;
  };
  satelit: { ada: boolean; sumber: string | null; atribusi: string | null };
  dimatikan: boolean;
  /** Alamat bawaan berkas peta dasar — ditampilkan sebagai petunjuk di layar. */
  sumberBawaan: string;
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

  /*
   * ISI BERKASNYA IKUT DIPERIKSA — teguran user 2026-09-06: *"berhasil
   * didownload, tapi malah jadi abu2. apa masalahmu sebenarnya!"*
   *
   * "Ada" tidak sama dengan "bisa digambar". Tiga keadaan membuat berkas yang
   * sah-sah saja tetap menghasilkan kanvas abu-abu — bukan PMTiles, ubinnya
   * raster, atau skemanya bukan Protomaps — dan ketiganya tidak terlihat dari
   * ukuran berkas. Membacanya cuma perlu 127 byte kepala + metadata, jadi
   * layar ini bisa menyebutnya alih-alih menyuruh orang menebak.
   */
  let isi: StatusPeta["dasar"]["isi"] = null;
  if (berkas.ada) {
    const hasil = await isiBasemapTerkini();
    const masalah = (await halanganDasar()) ?? "";
    const diminta = lapisanDiminta();
    isi =
      hasil && hasil.sah
        ? {
            sah: true,
            jenisUbin: hasil.kepala.jenisUbin,
            zoom: `z${hasil.kepala.zoomMin}–z${hasil.kepala.zoomMax}`,
            wilayah: hasil.kepala.batas.map((n) => n.toFixed(1)).join(", "),
            lapisanCocok: diminta.filter((l) => hasil.lapisan.includes(l)).length,
            lapisanArsip: hasil.lapisan.length,
            masalah,
          }
        : {
            sah: false,
            jenisUbin: null,
            zoom: null,
            wilayah: null,
            lapisanCocok: 0,
            lapisanArsip: 0,
            masalah,
          };
    if (masalah) sebab = masalah;
  }

  return {
    siap: (berkas.ada && !isi?.masalah) || satelitHidup,
    dasar: {
      ada: berkas.ada,
      lokasi: DIR_PETA,
      ukuranMb: berkas.ada ? Math.round((berkas.ukuran / 1024 / 1024) * 10) / 10 : null,
      diperbarui: berkas.diperbarui,
      sedangUnduh: unduhanBerjalan(),
      sebab,
      isi,
    },
    satelit: {
      ada: satelitHidup,
      sumber: satelitHidup ? satelitUrl : null,
      atribusi: satelitHidup ? env.PETA_SATELIT_ATRIBUSI?.trim() || SATELIT_ATRIBUSI_BAWAAN : null,
    },
    dimatikan,
    sumberBawaan:
      env.PETA_SUMBER_URL?.trim() ||
      "https://github.com/topikuning/marlin-gibaku/releases/download/peta-basemap/basemap-indonesia.pmtiles",
  };
}
