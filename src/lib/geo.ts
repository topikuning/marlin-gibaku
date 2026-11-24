/**
 * Koordinat lokasi proyek — SATU tempat aturannya.
 *
 * Sebelumnya tiap form punya rentangnya sendiri: form tambah lokasi target
 * menerima −90..90 / −180..180 (seluruh bumi), sementara form edit membatasi ke
 * wilayah Indonesia. Akibatnya titik yang mustahil (mis. tertukar lat↔lng, atau
 * salah tanda sehingga jatuh di Samudra Atlantik) bisa masuk lewat satu pintu
 * lalu ditolak di pintu lain. Semua pintu sekarang memakai fungsi di file ini.
 *
 * Batas = kotak wilayah Indonesia (Sabang–Merauke, Miangas–Rote) dgn sedikit
 * kelonggaran. Ini penyaring salah-ketik, bukan penentu batas negara.
 */

export const LAT_MIN = -11;
export const LAT_MAX = 6.5;
export const LNG_MIN = 95;
export const LNG_MAX = 141.5;

export type CoordParse =
  | { ok: true; lat: number; lng: number }
  | { ok: true; lat: null; lng: null }
  | { ok: false; error: string };

/** Angka dari isian manusia: terima koma desimal, buang spasi. */
function toNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Baca sepasang koordinat. Keduanya kosong = lokasi tanpa titik (sah).
 * Salah satu saja = ditolak — setengah koordinat tidak ada gunanya dan justru
 * menyesatkan peta serta cap foto.
 */
export function parseCoordinatePair(rawLat: unknown, rawLng: unknown): CoordParse {
  const lat = toNumber(rawLat);
  const lng = toNumber(rawLng);

  if (lat === null && lng === null) return { ok: true, lat: null, lng: null };
  if (lat === null || lng === null) {
    return { ok: false, error: "Isi latitude dan longitude bersamaan, atau kosongkan keduanya." };
  }
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return { ok: false, error: "Koordinat harus diisi angka, misalnya -6.8710100 dan 109.2531230." };
  }
  // Petunjuk khusus untuk kekeliruan paling sering: lat & lng tertukar.
  if (
    (lat < LAT_MIN || lat > LAT_MAX) &&
    (lng >= LAT_MIN && lng <= LAT_MAX) &&
    (lat >= LNG_MIN && lat <= LNG_MAX)
  ) {
    return {
      ok: false,
      error: `Latitude dan longitude sepertinya tertukar. Coba latitude ${lng} dan longitude ${lat}.`,
    };
  }
  if (lat < LAT_MIN || lat > LAT_MAX) {
    return {
      ok: false,
      error: `Latitude ${lat} di luar wilayah Indonesia (antara ${LAT_MIN} dan ${LAT_MAX}). Latitude Indonesia umumnya negatif karena berada di selatan khatulistiwa.`,
    };
  }
  if (lng < LNG_MIN || lng > LNG_MAX) {
    return {
      ok: false,
      error: `Longitude ${lng} di luar wilayah Indonesia (antara ${LNG_MIN} dan ${LNG_MAX}).`,
    };
  }
  return { ok: true, lat, lng };
}

/** Bentuk simpan ke kolom Decimal(10,7) — null bila tak ada titik. */
export function coordinateForDb(v: number | null): string | null {
  return v == null ? null : v.toFixed(7);
}

/* ── Titik dari GPS HP (DECISIONS 772) ───────────────────────────────────── */

/** Jarak dua titik dalam meter (haversine, bumi bulat r = 6.371 km). */
export function jarakMeter(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Akurasi GPS HP (meter) yang dianggap baik. */
export const AKURASI_BAIK_M = 30;
/**
 * Di atas ini titik HP DITOLAK: biasanya posisi dari menara seluler atau GPS
 * yang belum terkunci satelit, bisa meleset ratusan meter sampai kilometer.
 */
export const AKURASI_TOLAK_M = 100;

export type MutuAkurasi = "baik" | "sedang" | "lemah";

export function mutuAkurasi(meter: number): MutuAkurasi {
  if (meter <= AKURASI_BAIK_M) return "baik";
  if (meter <= AKURASI_TOLAK_M) return "sedang";
  return "lemah";
}
