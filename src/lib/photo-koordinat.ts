/**
 * Penyaring koordinat foto — MODUL MURNI, tanpa dependensi server.
 *
 * Dipisah dari `lib/photos.ts` (yang menarik sharp, db, dan R2) supaya bisa
 * diuji langsung. Isinya kecil tapi bukan sepele: koordinat yang lolos dari
 * sini akan ditulis ke kolom `Decimal` DAN dipakai sebagai bukti GPS di cap
 * foto. Yang salah di sini berakhir sebagai angka palsu di dokumen resmi.
 *
 * DECISIONS 231.
 */

/**
 * Angka koordinat yang benar-benar angka, atau null.
 *
 * `typeof NaN === "number"` — jadi memeriksa tipe saja MELOLOSKAN NaN.
 * ExifReader mengembalikan NaN bila tag GPS ada tapi rusak/tak lengkap (mis.
 * GPSLatitude tanpa GPSLatitudeRef, atau hasil konversi HEIC→JPEG setengah
 * jadi) — dan NaN itu ditulis sebagai string "NaN" ke kolom Decimal, ditolak
 * Prisma, lalu menjatuhkan SELURUH unggahan.
 *
 * Rentang ikut diperiksa: EXIF cacat juga bisa memberi angka berhingga tapi
 * mustahil (lintang 200°). Koordinat mustahil bukan "kurang akurat" — ia bukan
 * koordinat, dan kalau lolos ia jadi bukti GPS palsu.
 */
export function angkaKoordinat(v: unknown, maks: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= maks ? v : null;
}

/**
 * Sepasang koordinat, atau sepasang null.
 *
 * Salah satu hilang = pasangannya tidak berarti apa-apa: lintang tanpa bujur
 * tidak menunjuk tempat mana pun, dan menyimpannya setengah hanya menyisakan
 * data yang kelihatan ada padahal tidak bisa dipakai.
 */
export function pasanganKoordinat(
  lat: unknown,
  lng: unknown,
): { lat: number | null; lng: number | null } {
  const a = angkaKoordinat(lat, 90);
  const b = angkaKoordinat(lng, 180);
  return a == null || b == null ? { lat: null, lng: null } : { lat: a, lng: b };
}

/**
 * Koordinat → string untuk kolom `Decimal(10,7)`, atau null.
 *
 * Lapis terakhir sebelum database, sengaja rangkap dengan penyaringan di atas:
 * koordinat juga bisa datang dari klien (GPS perangkat), dan jalur mana pun
 * yang membawa nilai tidak berhingga harus berhenti di sini — bukan di Prisma,
 * yang kegagalannya bukan `PhotoError` sehingga melompati seluruh penanganan.
 */
export function desimalKoordinat(v: number | null | undefined): string | null {
  return v != null && Number.isFinite(v) ? v.toFixed(7) : null;
}
