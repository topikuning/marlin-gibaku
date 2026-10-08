import { KKP_WEATHER_HOURS, type HourlyWeather, type KkpWeatherCategory } from "@/lib/weather/hourly";

/**
 * CUACA DARI PENGAMATAN SATELIT – bagian murni (DECISIONS baru 2026-10-07).
 *
 * Dua sumber, dua tugas:
 *   - Himawari-9 (JMA, arsip NOAA): AWAN. Penanda awan per piksel 2 km tiap
 *     10 menit. Dipakai untuk Cerah vs Mendung.
 *   - JAXA GSMaP Gauge NRT: HUJAN. Curah hujan per jam per kotak 0,1° (±11 km),
 *     sudah dikoreksi penakar hujan darat, tersedia ±4 jam sesudah kejadian.
 *
 * Tanpa db, tanpa jaringan – supaya aturan kategori dan geometri bisa diuji.
 */

// ── GSMaP ────────────────────────────────────────────────────────────────────

/** Grid GSMaP: 3600 × 1200 float32 little-endian, 60°LU–60°LS, bujur 0–360. */
export const GSMAP_LEBAR = 3600;
export const GSMAP_TINGGI = 1200;
export const GSMAP_BITA = GSMAP_LEBAR * GSMAP_TINGGI * 4;

/** Posisi kotak 0,1° yang memuat titik; null di luar cakupan 60°LU–60°LS. */
export function indeksGsmap(lat: number, lng: number): { x: number; y: number } | null {
  if (!(lat < 60 && lat > -60) || !Number.isFinite(lng)) return null;
  const bujur = ((lng % 360) + 360) % 360;
  const x = Math.min(GSMAP_LEBAR - 1, Math.floor(bujur * 10 + 1e-9));
  const y = Math.min(GSMAP_TINGGI - 1, Math.floor((60 - lat) * 10 + 1e-9));
  return { x, y };
}

/**
 * Curah hujan (mm/jam) di titik dari isi berkas GSMaP yang sudah diurai gzip.
 * Nilai negatif = tidak ada pengamatan → null (BUKAN 0: "tidak tahu" tidak
 * boleh tercetak sebagai "tidak hujan").
 */
export function hujanDariGrid(isi: Uint8Array, lat: number, lng: number): number | null {
  if (isi.length !== GSMAP_BITA) {
    throw new Error(`Berkas GSMaP berukuran ${isi.length} bita, seharusnya ${GSMAP_BITA}.`);
  }
  const i = indeksGsmap(lat, lng);
  if (!i) return null;
  const v = new DataView(isi.buffer, isi.byteOffset, isi.byteLength).getFloat32((i.y * GSMAP_LEBAR + i.x) * 4, true);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** `realtime_ver/v8/hourly_G/2026/10/06/gsmap_gauge.20261006.0300.dat.gz` */
export function jalurGsmap(versi: string, tanggalUtc: string, jamUtc: number): string {
  const [y, m, d] = tanggalUtc.split("-");
  const hh = String(jamUtc).padStart(2, "0");
  return `realtime_ver/${versi}/hourly_G/${y}/${m}/${d}/gsmap_gauge.${y}${m}${d}.${hh}00.dat.gz`;
}

/** Versi tertinggi dulu (v10 > v9 > v8), hanya nama folder berbentuk "vN". */
export function urutkanVersiGsmap(nama: string[]): string[] {
  return nama
    .filter((n) => /^v\d+$/.test(n))
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
}

// ── Himawari ─────────────────────────────────────────────────────────────────

/** Geometri piksel 2 km AHI (JMA Himawari Standard Data), satelit di 140,7°BT. */
const SUB_LON = 140.7;
const CFAC = 20466275;
const LFAC = 20466275;
const OFF = 2750.5;
export const HIMAWARI_UKURAN = 5500;

/** Baris & kolom piksel (0-based) penanda awan full disk 2 km. */
export function pikselHimawari(lat: number, lng: number): { baris: number; kolom: number } | null {
  const rad = Math.PI / 180;
  const la = lat * rad;
  const dl = (lng - SUB_LON) * rad;
  const cLat = Math.atan(0.993305616 * Math.tan(la));
  const rl = 6356.7523 / Math.sqrt(1 - 0.00669438444 * Math.cos(cLat) ** 2);
  const r1 = 42164 - rl * Math.cos(cLat) * Math.cos(dl);
  const r2 = -rl * Math.cos(cLat) * Math.sin(dl);
  const r3 = rl * Math.sin(cLat);
  // Titik di balik bumi (tidak terlihat satelit).
  if (r1 * (r1 - 42164) + r2 * r2 + r3 * r3 > 0) return null;
  const rn = Math.sqrt(r1 * r1 + r2 * r2 + r3 * r3);
  const x = Math.atan(-r2 / r1) / rad;
  const y = Math.asin(-r3 / rn) / rad;
  const kolom = Math.round(OFF + (x * CFAC) / 2 ** 16) - 1;
  const baris = Math.round(OFF + (y * LFAC) / 2 ** 16) - 1;
  if (baris < 0 || kolom < 0 || baris >= HIMAWARI_UKURAN || kolom >= HIMAWARI_UKURAN) return null;
  return { baris, kolom };
}

/**
 * Persentase awan di jendela piksel penanda awan (0 cerah, 1 mungkin cerah,
 * 2 mungkin berawan, 3 berawan). Piksel tanpa nilai sah dilewati; kalau
 * yang sah kurang dari separuh, hasilnya null (tidak cukup untuk menyimpulkan).
 */
export function persenAwan(jendela: number[][]): number | null {
  let sah = 0;
  let awan = 0;
  let total = 0;
  for (const baris of jendela) {
    for (const v of baris) {
      total++;
      if (!Number.isInteger(v) || v < 0 || v > 3) continue;
      sah++;
      if (v >= 2) awan++;
    }
  }
  if (sah === 0 || sah * 2 < total) return null;
  return Math.round((awan / sah) * 100);
}

export function jarakKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── Penggabungan ─────────────────────────────────────────────────────────────

/**
 * Ambang hujan satelit (mm/jam). Lebih tinggi dari ambang model (0,2) karena
 * GSMaP per jam cenderung memberi alarm palsu pada hujan sangat ringan (uji
 * 586 penakar BMKG, Remote Sensing 2023).
 */
export const HUJAN_SATELIT_MM = 0.5;
/** Lebih dari separuh langit sekitar lokasi (±10×10 km) tertutup awan → Mendung. */
export const AWAN_MENDUNG_PERSEN = 50;
/**
 * Tanpa data hujan, satu jam hanya boleh disebut Cerah bila langitnya nyaris
 * bersih – awan tipis-sedikit tidak mungkin menurunkan hujan. Selebihnya jam
 * itu dikosongkan, bukan ditebak.
 */
export const AWAN_CERAH_TANPA_HUJAN_PERSEN = 20;

/**
 * Kategori blanko KKP untuk satu jam dari pengamatan satelit. Null = data
 * tidak cukup untuk menyatakan apa pun; jam itu dibiarkan kosong.
 *
 * `code` = kode WMO SETARA (0 cerah, 1 hampir cerah, 3 mendung, 61/65 hujan)
 * supaya ringkasan harian dan ekspor lama tetap bekerja; asal datanya dicatat
 * di `weather_observations.provider`.
 */
export function kategoriSatelit(
  jam: number,
  awanPersen: number | null,
  hujanMm: number | null,
): HourlyWeather | null {
  const jadi = (category: KkpWeatherCategory, code: number): HourlyWeather => ({
    hour: jam,
    category,
    precipMm: hujanMm != null ? Math.round(hujanMm * 100) / 100 : 0,
    code,
    ...(awanPersen != null ? { cloudPct: awanPersen } : {}),
  });
  if (hujanMm != null && hujanMm >= HUJAN_SATELIT_MM) return jadi("Hujan", hujanMm >= 4 ? 65 : 61);
  if (awanPersen == null) return null;
  if (hujanMm == null) {
    return awanPersen < AWAN_CERAH_TANPA_HUJAN_PERSEN ? jadi("Cerah", 0) : null;
  }
  if (awanPersen >= AWAN_MENDUNG_PERSEN) return jadi("Mendung", 3);
  return jadi("Cerah", awanPersen < AWAN_CERAH_TANPA_HUJAN_PERSEN ? 0 : 1);
}

/**
 * Kolom jam `h` di blanko = rentang h.00–h.59 WIB = jam UTC h−7 di tanggal yang
 * sama (blanko 07–21 WIB = 00–14 UTC). Jam itu baru "sudah terjadi" setelah
 * (h+1).00 WIB lewat.
 */
export function jamUtc(jamWib: number): number {
  return jamWib - 7;
}

export function jamSudahLewat(dateKey: string, jamWib: number, sekarang: Date): boolean {
  const akhir = Date.parse(`${dateKey}T${String(jamWib + 1).padStart(2, "0")}:00:00+07:00`);
  return sekarang.getTime() >= akhir;
}

// ── Pembaruan pukul 04.00 ───────────────────────────────────────────────────

export type BacaanSatelit = { awan: number | null; hujan: number | null };

/**
 * Gabungkan per jam (DECISIONS 657): pengamatan satelit dipakai di jam yang
 * kategorinya bisa disimpulkan darinya (`kategoriSatelit` tidak null);
 * selebihnya jam dari model Open-Meteo dipertahankan. Pengamatan menang atas
 * model karena ia mengukur, bukan menghitung; model tetap mengisi jam yang
 * satelitnya kosong supaya blanko tidak bolong.
 */
export function gabungkanJam(
  model: HourlyWeather[],
  satelit: Map<number, BacaanSatelit>,
): { hours: HourlyWeather[]; jamSatelit: number; jamModel: number } {
  const hours: HourlyWeather[] = [];
  let jamSatelit = 0;
  let jamModel = 0;
  for (const jam of KKP_WEATHER_HOURS) {
    const s = satelit.get(jam);
    const k = s ? kategoriSatelit(jam, s.awan, s.hujan) : null;
    if (k) {
      hours.push({ ...k, sumber: "satelit" });
      jamSatelit++;
      continue;
    }
    const m = model.find((h) => h.hour === jam);
    if (m) {
      hours.push({ hour: m.hour, category: m.category, precipMm: m.precipMm, code: m.code, sumber: "model" });
      jamModel++;
    }
  }
  return { hours, jamSatelit, jamModel };
}
