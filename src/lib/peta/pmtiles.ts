/**
 * PEMBACA KEPALA BERKAS PMTILES — supaya peta abu-abu menyebut sebabnya.
 *
 * Keluhan user 2026-09-06: *"berhasil didownload, tapi malah jadi abu2. apa
 * masalahmu sebenarnya!"*
 *
 * Keluhan itu benar dan menunjuk lubang di rancangan saya: unduhan dianggap
 * berhasil hanya karena servernya menjawab 200 dan berkasnya tidak nol byte.
 * Padahal ada tiga cara berkas yang "terunduh" tetap menghasilkan kanvas
 * abu-abu, dan ketiganya diam:
 *
 *   1. **Yang terunduh bukan PMTiles.** Alamat yang salah sering menjawab 200
 *      berisi halaman HTML ("Not Found" versi cantik) atau halaman login. Ia
 *      punya ukuran, jadi lolos pemeriksaan ukuran, lalu gagal saat dibaca
 *      peramban — tanpa pesan.
 *   2. **PMTiles-nya raster, bukan vektor.** Gaya Protomaps menggambar dari
 *      ubin vektor; diberi arsip PNG ia tidak menemukan satu pun lapisan dan
 *      menghasilkan — tepatnya — abu-abu.
 *   3. **Vektor, tapi SKEMA-nya lain.** Arsip OpenMapTiles memakai nama lapisan
 *      yang berbeda dari skema Protomaps. Semua lapisan gaya menunjuk nama yang
 *      tidak ada di arsip, jadi tidak ada yang tergambar. Ini penyebab peta
 *      abu-abu yang paling sering dan paling tidak kelihatan: berkasnya sehat,
 *      besarnya benar, isinya benar — cuma bukan yang diminta gaya ini.
 *
 * Berkas modul ini murni (tanpa fs) supaya bisa diuji dengan kepala buatan:
 * yang dijaga adalah PEMBACAANNYA, bukan berkas 300 MB-nya.
 *
 * Rujukan format: PMTiles v3 — kepala 127 byte, little-endian.
 */

/** Panjang kepala PMTiles v3 — tetap, tidak berversi. */
export const PANJANG_KEPALA = 127;

const MAGIC = "PMTiles";

export type JenisUbin = "vektor" | "png" | "jpeg" | "webp" | "avif" | "tidak diketahui";

const JENIS: Record<number, JenisUbin> = {
  0: "tidak diketahui",
  1: "vektor",
  2: "png",
  3: "jpeg",
  4: "webp",
  5: "avif",
};

export type Kompresi = "tidak diketahui" | "tanpa" | "gzip" | "brotli" | "zstd";

const KOMPRESI: Record<number, Kompresi> = {
  0: "tidak diketahui",
  1: "tanpa",
  2: "gzip",
  3: "brotli",
  4: "zstd",
};

export type KepalaPmtiles = {
  versi: number;
  jenisUbin: JenisUbin;
  zoomMin: number;
  zoomMax: number;
  /** [barat, selatan, timur, utara] dalam derajat. */
  batas: [number, number, number, number];
  metaOffset: number;
  metaPanjang: number;
  kompresiDalam: Kompresi;
};

export type HasilKepala =
  | { sah: true; kepala: KepalaPmtiles }
  | { sah: false; sebab: string };

/** Cuplikan awal berkas dalam bentuk terbaca — dipakai saat menjelaskan kegagalan. */
export function cuplikan(buf: Uint8Array, n = 24): string {
  const potong = buf.subarray(0, n);
  let out = "";
  for (const b of potong) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  return out;
}

/**
 * Baca kepala PMTiles. Tidak melempar: kegagalan adalah JAWABAN, bukan
 * kecelakaan — yang memanggilnya ingin menampilkan sebabnya di layar.
 */
export function bacaKepalaPmtiles(buf: Uint8Array): HasilKepala {
  /*
   * MAGIC DIPERIKSA LEBIH DULU, baru panjangnya.
   *
   * Urutan sebaliknya (versi pertama, dipergoki ujinya sendiri) menjawab
   * "terlalu pendek" untuk halaman HTML 51 byte — benar secara teknis, dan
   * menyesatkan orang ke arah yang salah: yang perlu mereka tahu bukan
   * ukurannya, melainkan bahwa yang terunduh sama sekali bukan berkas peta.
   */
  let magic = "";
  for (let i = 0; i < Math.min(7, buf.length); i++) magic += String.fromCharCode(buf[i]);
  if (magic !== MAGIC)
    return {
      sah: false,
      sebab: `bukan berkas PMTiles – 24 byte pertamanya berbunyi "${cuplikan(buf)}". Alamat yang salah kerap menjawab 200 berisi halaman HTML atau halaman masuk, dan itu ikut tersimpan sebagai berkas peta.`,
    };

  if (buf.length < PANJANG_KEPALA)
    return {
      sah: false,
      sebab: `berkasnya terlalu pendek (${buf.length} byte) untuk kepala PMTiles – kemungkinan unduhan terpotong.`,
    };

  const versi = buf[7];
  if (versi !== 3)
    return {
      sah: false,
      sebab: `PMTiles versi ${versi}; yang bisa dibaca peta ini versi 3. Bangun ulang arsipnya dengan pmtiles versi baru.`,
    };

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u64 = (o: number) => Number(dv.getBigUint64(o, true));
  const e7 = (o: number) => dv.getInt32(o, true) / 1e7;

  return {
    sah: true,
    kepala: {
      versi,
      jenisUbin: JENIS[buf[99]] ?? "tidak diketahui",
      zoomMin: buf[100],
      zoomMax: buf[101],
      batas: [e7(102), e7(106), e7(110), e7(114)],
      metaOffset: u64(24),
      metaPanjang: u64(32),
      kompresiDalam: KOMPRESI[buf[97]] ?? "tidak diketahui",
    },
  };
}

/**
 * Nama lapisan vektor di dalam arsip, dari metadata JSON-nya.
 *
 * Inilah yang dibandingkan dengan lapisan yang DIMINTA gaya: kalau tidak ada
 * satu pun yang beririsan, peta pasti abu-abu — dan sekarang bisa dikatakan
 * sebelum orang membuka petanya.
 */
export function namaLapisanMeta(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const vl = (meta as { vector_layers?: unknown }).vector_layers;
  if (!Array.isArray(vl)) return [];
  return vl
    .map((l) => (l && typeof l === "object" ? (l as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

/**
 * Apakah arsip ini punya yang dibutuhkan gaya?
 *
 * Sengaja TIDAK menuntut kecocokan penuh: gaya Protomaps menyebut puluhan
 * lapisan dan sebuah ekstrak wilayah wajar kehilangan sebagian (mis. tidak ada
 * gletser di Indonesia). Yang menandakan salah skema adalah irisan yang KOSONG
 * — arsipnya bicara kosakata lain sama sekali.
 */
export function skemaCocok(punyaArsip: string[], dimintaGaya: string[]): boolean {
  if (punyaArsip.length === 0 || dimintaGaya.length === 0) return true; // tak bisa dinilai
  const set = new Set(punyaArsip);
  return dimintaGaya.some((l) => set.has(l));
}
