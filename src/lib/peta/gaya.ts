import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

/**
 * GAYA PETA MARLIN — satu tempat, dipakai kedua peta (sebaran & pemilih titik).
 *
 * Keluhan user 2026-09-06: *"aku sangat tidak puas dengan leaflet. apa tidak
 * ada yang lebih baik? misal MapLibre GL JS"*.
 *
 * Yang sebenarnya membuat peta lama terlihat murah BUKAN Leaflet-nya,
 * melainkan sumber ubinnya: `tile.openstreetmap.org` — ubin raster komunitas
 * yang buram di layar retina, labelnya ikut melar saat diperbesar, dan
 * **memang bukan untuk aplikasi produksi**. Kebijakan penggunaan ubin OSM
 * melarangnya; server itu bisa memblokir kita kapan saja, dan peta mati tanpa
 * satu pun peringatan di layar. Jadi kepindahan ke MapLibre dikerjakan
 * sekaligus dengan kepindahan sumber ubin.
 *
 * Dua lapisan, dua kegunaan berbeda (ketetapan user hari yang sama):
 *
 * - **Peta dasar vektor** (Protomaps, berkas `.pmtiles` milik sendiri di R2):
 *   untuk MEMBACA wilayah — nama desa, jalan, garis pantai — tajam di semua
 *   tingkat perbesaran karena digambar ulang, bukan gambar yang dibesarkan.
 * - **Citra satelit**: untuk MEMBUKTIKAN titiknya benar. Koordinat kampung
 *   nelayan yang meleset ke tengah sawah kelihatan seketika di citra, dan tidak
 *   pernah kelihatan di peta jalan.
 *
 * Keduanya boleh kosong. Peta yang kehilangan sumbernya harus mengatakannya
 * (lihat `PetaKosong` di komponen), bukan menampilkan kanvas abu-abu yang
 * terbaca sebagai "tidak ada lokasi".
 */

/** Nama sumber di dalam gaya — dipakai komponen saat menambah lapisan sendiri. */
export const SUMBER_DASAR = "dasar";
export const SUMBER_SATELIT = "satelit";

/** Awalan id lapisan satelit; dipakai untuk menyalakan/mematikan lapisannya. */
export const LAPIS_SATELIT = "satelit-raster";

export type SumberPeta = {
  /**
   * URL berkas `.pmtiles` (biasanya URL bertanda-tangan dari R2). Null = belum
   * ada; peta jatuh ke satelit saja dan mengatakannya.
   */
  pmtiles: string | null;
  /** Templat ubin citra satelit ({z}/{y}/{x}). Null = tanpa lapisan satelit. */
  satelit: string | null;
  /** Atribusi WAJIB tampil untuk citra satelit — syarat pemakaiannya. */
  satelitAtribusi: string | null;
};

/** Mode tampilan yang bisa dipilih orang lewat tombol di peta. */
export type ModePeta = "peta" | "satelit";

/**
 * Susun gaya MapLibre dari sumber yang tersedia.
 *
 * Urutan lapisan disengaja: satelit di PALING BAWAH, peta dasar vektor di
 * atasnya. Saat mode satelit dipilih, komponen cukup menyembunyikan lapisan
 * dasar — label vektornya sendiri tetap boleh berdiri di atas citra kalau
 * suatu saat kita mau "satelit + nama tempat" (keduanya sudah ada di gaya
 * yang sama, tidak perlu memuat ulang peta).
 */
export function gayaPeta(sumber: SumberPeta, mode: ModePeta = "peta"): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const daftar: StyleSpecification["layers"] = [];

  if (sumber.satelit) {
    sources[SUMBER_SATELIT] = {
      type: "raster",
      tiles: [sumber.satelit],
      tileSize: 256,
      maxzoom: 19,
      attribution: sumber.satelitAtribusi ?? "",
    };
    daftar.push({
      id: LAPIS_SATELIT,
      type: "raster",
      source: SUMBER_SATELIT,
      layout: { visibility: mode === "satelit" ? "visible" : "none" },
    });
  }

  if (sumber.pmtiles) {
    sources[SUMBER_DASAR] = {
      type: "vector",
      url: `pmtiles://${sumber.pmtiles}`,
      attribution: '<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    };
    // Gaya bawaan Protomaps ("light"): terang, kontras rendah, label tenang —
    // peta di MARLIN adalah LATAR bagi penanda lokasi, bukan tontohannya
    // sendiri. Bahasa Indonesia dipilih supaya nama tempat cocok dengan yang
    // diucapkan orang lapangan.
    for (const l of layers(SUMBER_DASAR, namedFlavor("light"), { lang: "id" })) {
      daftar.push({
        ...l,
        layout: { ...l.layout, visibility: mode === "peta" ? "visible" : "none" },
      } as (typeof daftar)[number]);
    }
  }

  return {
    version: 8,
    // Glyphs & sprite dari Protomaps (CDN-nya sendiri, gratis dan tanpa kunci);
    // tanpa keduanya label vektor tidak bisa digambar sama sekali.
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
    sources,
    layers: daftar,
  };
}

/** Apakah gaya ini benar-benar punya sesuatu untuk digambar? */
export function adaSumber(sumber: SumberPeta): boolean {
  return Boolean(sumber.pmtiles || sumber.satelit);
}

/** Mode yang MASUK AKAL dipilih dengan sumber yang ada sekarang. */
export function modeTersedia(sumber: SumberPeta): ModePeta[] {
  const out: ModePeta[] = [];
  if (sumber.pmtiles) out.push("peta");
  if (sumber.satelit) out.push("satelit");
  return out;
}

/**
 * Apakah peramban ini bisa menggambar peta sama sekali?
 *
 * MapLibre menggambar lewat WebGL. Di HP Android lawas yang dipakai orang
 * lapangan — dan di peramban yang mematikan akselerasi — WebGL tidak ada, dan
 * peta akan gagal TANPA pesan apa pun: kanvas kosong yang terbaca sebagai
 * "tidak ada lokasi". Diperiksa lebih dulu supaya layar bisa mengatakannya.
 */
export function dukungWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
