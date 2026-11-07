/**
 * TAUTAN "BUKA DI GOOGLE MAPS" – modul murni (DECISIONS 749).
 *
 * Permintaan user 2026-11-07: *"lokasi punya koordinat, tapi tidak satupun ada
 * tombol atau link yang sekali klik bisa membuka google map"*.
 *
 * Bentuknya URL resmi Maps (`/maps/search/?api=1&query=lat,lng`): di ponsel ia
 * membuka aplikasi Google Maps dengan pin di titik itu, dan dari situ tombol
 * Rute Google sendiri yang mengantar ke lokasinya. Tanpa kunci API, tanpa
 * pelacakan.
 *
 * Tautan HANYA dibuat dari koordinat yang masuk akal. 0,0 (kolom yang belum
 * diisi lalu tersimpan nol) dan angka di luar rentang bumi menghasilkan
 * `null` – tombol yang mengantar orang lapangan ke Teluk Guinea lebih buruk
 * daripada tidak ada tombol.
 */

type Angka = number | string | null | undefined;

function angka(v: Angka): number | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function tautanGoogleMaps(lat: Angka, lng: Angka): string | null {
  const la = angka(lat);
  const lo = angka(lng);
  if (la == null || lo == null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  if (la === 0 && lo === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${la},${lo}`)}`;
}
