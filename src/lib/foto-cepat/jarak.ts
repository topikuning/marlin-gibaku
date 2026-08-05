/**
 * Jarak antar koordinat — MODUL MURNI (dipakai server & klien).
 *
 * Foto Cepat memakainya untuk MENGURUTKAN lokasi dari yang terdekat, lalu
 * MENAMPILKAN jaraknya. Dua-duanya penting: urutan menghemat ketukan, angkanya
 * membuat tebakan sistem bisa dinilai manusia. Lokasi terdekat yang ternyata
 * 12 km jauhnya adalah tanda pelapor belum sampai — dan itu hanya kelihatan
 * kalau angkanya ditulis, bukan kalau sistem diam-diam memilihkan.
 */

/** Haversine, meter. Bola rata-rata — cukup untuk urutan & penilaian manusia. */
export function jarakMeter(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Jarak siap-baca. Di bawah 1 km ditulis meter (angka bulat) karena di lapangan
 * itulah rentang yang menentukan "sudah di lokasi atau belum".
 */
export function labelJarak(meter: number): string {
  if (meter < 1000) return `${Math.round(meter)} m`;
  return `${(meter / 1000).toFixed(meter < 10_000 ? 1 : 0)} km`;
}

export type LokasiBerkoordinat = { id: string; name: string; lat: number | null; lng: number | null };
export type LokasiBerjarak = LokasiBerkoordinat & { jarakMeter: number | null };

/**
 * Urutkan lokasi dari yang terdekat. Lokasi TANPA koordinat tidak dibuang —
 * ia hanya turun ke bawah. Membuangnya berarti lokasi yang titiknya belum
 * diisi mendadak tidak bisa dipakai memotret, dan sebabnya tak akan pernah
 * terlihat dari lapangan.
 */
export function urutkanTerdekat(
  lokasi: LokasiBerkoordinat[],
  posisi: { lat: number; lng: number } | null,
): LokasiBerjarak[] {
  const out = lokasi.map((l) => ({
    ...l,
    jarakMeter:
      posisi && l.lat != null && l.lng != null
        ? Math.round(jarakMeter(posisi.lat, posisi.lng, l.lat, l.lng))
        : null,
  }));
  if (!posisi) return out;
  return out.sort((a, b) => {
    if (a.jarakMeter == null && b.jarakMeter == null) return a.name.localeCompare(b.name);
    if (a.jarakMeter == null) return 1;
    if (b.jarakMeter == null) return -1;
    return a.jarakMeter - b.jarakMeter;
  });
}
