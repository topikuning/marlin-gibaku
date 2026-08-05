/**
 * KESEGARAN BACAAN GPS — modul murni (DECISIONS 256).
 *
 * Kamera dalam aplikasi mengikuti posisi lewat `watchPosition`, yang memberi
 * ARUS pembaruan. Arus itu bisa berhenti — masuk bangunan, sinyal hilang,
 * baterai hemat daya — sementara pelapor terus berjalan dan terus memotret.
 * Nilai terakhir yang tersimpan tetap terlihat sah padahal sudah tidak
 * menggambarkan posisi sekarang.
 *
 * Itu persis jebakan yang dibuang di DECISIONS 219 (`maximumAge: 60000` membuat
 * "foto di lokasi B membawa titik lokasi A"), hanya lewat pintu lain. Karena itu
 * umurnya diperiksa pada DETIK RANA DITEKAN, dan yang lewat ambang DIBUANG —
 * bukan dipakai dengan catatan kecil. Koordinat basi bukan "kurang akurat"; ia
 * menunjuk tempat yang salah, dan foto lapangan adalah bukti.
 */

/** Bacaan lebih tua dari ini tidak boleh menempel ke foto. */
export const UMUR_GPS_MAKS_MS = 15_000;

export type BacaanGps = { lat: number; lng: number; waktu: number } | null;
export type PosisiJepret = { lat: number; lng: number } | null;

/**
 * Koordinat yang boleh dipakai untuk satu jepretan, atau null.
 *
 * `null` di sini BUKAN kegagalan — ia jawaban jujur "posisi saat memotret tidak
 * diketahui", dan hilirnya sudah menanganinya: fotonya tetap tersimpan, lokasi
 * tidak ditebak, dan titik proyek tidak dipakai sebagai pengganti.
 */
export function posisiJepret(g: BacaanGps, sekarang: number): PosisiJepret {
  if (!g) return null;
  const umur = sekarang - g.waktu;
  // Bacaan dari MASA DEPAN (jam perangkat mundur saat sinkronisasi waktu) juga
  // ditolak: umur negatif berarti perbandingannya tidak bisa dipercaya.
  if (umur < 0 || umur > UMUR_GPS_MAKS_MS) return null;
  return { lat: g.lat, lng: g.lng };
}
