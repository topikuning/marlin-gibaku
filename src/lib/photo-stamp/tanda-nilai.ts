/**
 * TANDA ASAL NILAI — DISAMPAIKAN LEWAT WARNA, BUKAN TULISAN.
 *
 * Ketetapan user 2026-09-04: *"hilangkan informasi jam tidak tercatat, titik
 * proyek, dan lain sebagainya. gunakan pewarnaan saja yang hanya diketahui
 * admin atau orang tertentu"* — dan *"semua informasi itu tidak perlu tercatat
 * secara eksplisit di laporan mana pun … cukup mainkan warna pada
 * informasinya"*.
 *
 * Ini MEREVISI BENTUK, BUKAN ISI, dari DECISIONS 197. Yang dilarang 197 tetap
 * dilarang: nilai yang bukan bacaan alat tidak boleh tampil seolah-olah bacaan
 * alat. Yang berubah cuma cara menandainya — dulu tulisan kecil di sebelah
 * nilai ("titik proyek", "jam tidak tercatat"), sekarang WARNA nilai itu
 * sendiri. Dan tanda itu tetap wajib ada: menghapusnya sama sekali barulah
 * melanggar 197.
 *
 * Empat golongan, satu daftar, dipakai cap gambar · PDF · layar:
 *
 * | Golongan   | Artinya                                                    |
 * |------------|------------------------------------------------------------|
 * | `asli`     | bacaan alat pada foto ini — waktu jepret / GPS perangkat    |
 * | `cadangan` | bukan bacaan alat: koordinat titik proyek                   |
 * | `manual`   | diketik orang                                              |
 * | `unggah`   | terbaca saat MENGUNGGAH, bukan saat memotret               |
 *
 * KETERBATASAN YANG DIAKUI, bukan disembunyikan: warna hilang pada cetakan
 * hitam-putih dan fotokopi, dan tidak terbaca sebagian pembaca buta warna.
 * Karena itu golongan aslinya TETAP tersimpan di basis data (`Photo.gpsSource`,
 * `metadataSource`) dan tetap bisa disaring di layar — warna adalah cara
 * MENAMPILKAN, bukan tempat menyimpan. Siapa pun yang perlu memastikan sebuah
 * foto tetap bisa membuktikannya dari datanya, bukan dari matanya.
 */

export type TandaNilai = "asli" | "cadangan" | "manual" | "unggah";

/** Sumber koordinat sebagaimana tersimpan di `Photo.gpsSource`. */
export type SumberKoordinat = "exif" | "device" | "project" | "manual" | "none" | null;

/**
 * Golongan koordinat. `asalGaleri` menandai foto yang dipilih DARI GALERI:
 * koordinat perangkat pada foto galeri adalah posisi saat mengunggah, bukan
 * saat memotret (DECISIONS 197/220).
 */
export function tandaKoordinat(src: SumberKoordinat, asalGaleri = false): TandaNilai {
  if (src === "project") return "cadangan";
  if (src === "manual") return "manual";
  // `exif` = koordinat menempel pada berkas fotonya sendiri: asli, dari mana
  // pun foto itu dipilih. `device` = bacaan alat SAAT ITU — pada foto galeri
  // itu posisi saat mengunggah, bukan saat memotret.
  if (src === "device") return asalGaleri ? "unggah" : "asli";
  return "asli";
}

export type SumberWaktu = "exif" | "device" | "filename" | "server" | "manual" | null;

export function tandaWaktu(v: { jamDiketahui: boolean; timeSource?: SumberWaktu }): TandaNilai {
  // Jam yang tidak diketahui TIDAK dicetak sebagai angka (197) — yang tersisa
  // di layar/cap cuma tanggalnya, dan tanggal itu memang tanggal kerjanya.
  if (!v.jamDiketahui) return "cadangan";
  if (v.timeSource === "manual") return "manual";
  if (v.timeSource === "server") return "unggah";
  return "asli";
}

/**
 * Warna untuk CAP GAMBAR — teks putih di atas overlay gelap. Nilai `asli`
 * memakai putih biasa supaya cap yang normal tidak terlihat "ditandai".
 */
export const WARNA_CAP: Record<TandaNilai, string> = {
  asli: "#FFFFFF",
  cadangan: "#FBBF24",
  manual: "#93C5FD",
  unggah: "#6EE7B7",
};

/** Warna untuk PDF — teks gelap di atas kertas putih. */
export const WARNA_PDF: Record<TandaNilai, string> = {
  asli: "#4b5563",
  cadangan: "#b45309",
  manual: "#1d4ed8",
  unggah: "#047857",
};

/** Kelas layar (token, bukan hex) untuk titik penanda di galeri. */
export const KELAS_LAYAR: Record<TandaNilai, string> = {
  asli: "bg-success",
  cadangan: "bg-warning",
  manual: "bg-primary",
  unggah: "bg-info",
};
