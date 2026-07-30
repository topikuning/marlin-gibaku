import type { WeatherCode } from "@/generated/prisma/enums";

/**
 * Lapisan MURNI cuaca per jam — tanpa jaringan, tanpa DB, tanpa `server-only`,
 * sehingga bisa dipakai komponen cetak sekaligus diuji tanpa mock.
 *
 * Kenapa per jam: blanko KKP "Kondisi Cuaca" punya 15 kolom jam (07.00–21.00)
 * dengan 3 baris kategori (Cerah / Mendung / Hujan). Sebelum ini sistem hanya
 * menyimpan SATU kategori sehari penuh dan mencentangnya seragam di kelima
 * belas kolom — hujan sejam sore tercetak sama dengan hujan seharian.
 *
 * Laporan harian diisi di UJUNG hari, jadi yang relevan adalah jam-jam yang
 * SUDAH terjadi (data pengamatan/analisis), bukan prakiraan (DECISIONS 176).
 */

/** Tiga kategori yang ada di blanko KKP — bukan pilihan bebas. */
export type KkpWeatherCategory = "Cerah" | "Mendung" | "Hujan";

export type HourlyWeather = {
  /** Jam lokal Asia/Jakarta, 7..21. */
  hour: number;
  category: KkpWeatherCategory;
  /** Curah hujan jam itu (mm). */
  precipMm: number;
  /** Kode cuaca WMO asli — disimpan demi jejak asal-usul. */
  code: number;
};

/** Kolom jam pada blanko KKP (07.00–21.00). */
export const KKP_WEATHER_HOURS: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
];

/** Ambang curah hujan (mm/jam) yang dianggap benar-benar hujan. */
const RAIN_MM_THRESHOLD = 0.2;
/** Ambang hujan DERAS (mm/jam) — dipakai meringkas ke satu kode harian. */
const HEAVY_RAIN_MM = 4;

/** Kode WMO yang berarti hujan lebat/badai (dipakai untuk ringkasan harian). */
const HEAVY_WMO = new Set([65, 67, 75, 82, 95, 96, 99]);

/**
 * Kode cuaca WMO → kategori blanko KKP.
 * 0–1 cerah · 2–3 berawan/mendung · 45/48 kabut → mendung ·
 * 51+ gerimis/hujan/salju/badai → hujan.
 * Curah hujan terukur MENANG atas kode: kalau tercatat hujan, tulis Hujan.
 */
export function categoryFromWmo(code: number, precipMm: number): KkpWeatherCategory {
  if (precipMm >= RAIN_MM_THRESHOLD) return "Hujan";
  if (code >= 51) return "Hujan";
  if (code === 45 || code === 48) return "Mendung";
  if (code === 2 || code === 3) return "Mendung";
  return "Cerah";
}

/**
 * Rangkai deret per jam dari respons penyedia (waktu lokal, sudah Asia/Jakarta)
 * untuk SATU tanggal, dibatasi jam blanko 07–21. Jam yang datanya tidak ada
 * (mis. hari berjalan yang belum sampai jam 21) dilewati — jangan mengarang.
 */
export function buildHourlyWeather(
  input: { time: string[]; weatherCode: (number | null)[]; precipitation: (number | null)[] },
  dateKey: string,
): HourlyWeather[] {
  const out: HourlyWeather[] = [];
  for (let i = 0; i < input.time.length; i++) {
    const stamp = input.time[i]; // "2026-07-29T13:00"
    if (!stamp?.startsWith(`${dateKey}T`)) continue;
    const hour = Number(stamp.slice(11, 13));
    if (!KKP_WEATHER_HOURS.includes(hour)) continue;
    const code = input.weatherCode[i];
    const precip = input.precipitation[i];
    if (code == null || !Number.isFinite(code)) continue;
    const precipMm = precip != null && Number.isFinite(precip) ? Math.max(0, precip) : 0;
    out.push({ hour, category: categoryFromWmo(code, precipMm), precipMm, code });
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/**
 * Ringkas deret per jam menjadi SATU `WeatherCode` (kolom lama yang dipakai
 * ekspor/AI/WhatsApp). `angin_kencang` dan `banjir` TIDAK pernah dihasilkan
 * otomatis — keduanya kejadian lokal yang hanya sah dari pengamatan lapangan.
 */
export function dominantWeatherCode(hours: HourlyWeather[]): WeatherCode | null {
  if (hours.length === 0) return null;
  const heavy = hours.some((h) => h.precipMm >= HEAVY_RAIN_MM || HEAVY_WMO.has(h.code));
  if (heavy) return "hujan_deras";
  if (hours.some((h) => h.category === "Hujan")) return "hujan_ringan";
  const mendung = hours.filter((h) => h.category === "Mendung").length;
  return mendung > hours.length - mendung ? "berawan" : "cerah";
}

/** Jumlah JAM hujan (diturunkan, tidak pernah disimpan sebagai kolom). */
export function countRainHours(hours: HourlyWeather[]): number {
  return hours.filter((h) => h.category === "Hujan").length;
}

/** Total curah hujan (mm) sepanjang jam blanko — diturunkan. */
export function totalRainMm(hours: HourlyWeather[]): number {
  return Math.round(hours.reduce((t, h) => t + h.precipMm, 0) * 10) / 10;
}

const CATEGORIES: KkpWeatherCategory[] = ["Cerah", "Mendung", "Hujan"];

/**
 * Baca kolom Json dari DB dengan aman. Bentuk tak dikenal → null (jatuh ke
 * perilaku lama: satu kategori sehari), JANGAN melempar di jalur cetak.
 */
export function parseHourlyWeather(value: unknown): HourlyWeather[] | null {
  if (!Array.isArray(value)) return null;
  const out: HourlyWeather[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const hour = typeof r.hour === "number" ? r.hour : Number.NaN;
    const category = r.category;
    if (!KKP_WEATHER_HOURS.includes(hour)) return null;
    if (typeof category !== "string" || !CATEGORIES.includes(category as KkpWeatherCategory)) return null;
    out.push({
      hour,
      category: category as KkpWeatherCategory,
      precipMm: typeof r.precipMm === "number" ? r.precipMm : 0,
      code: typeof r.code === "number" ? r.code : 0,
    });
  }
  return out.length > 0 ? out.sort((a, b) => a.hour - b.hour) : null;
}

/**
 * Peta jam → kategori untuk pencentangan blanko, sebagai objek biasa supaya
 * aman menyeberang batas server → client (Map tidak ikut terserialisasi).
 * Jam tanpa data sengaja TIDAK muncul — blanko dibiarkan kosong, bukan ditebak.
 */
export function hourlyCategoryEntries(hours: HourlyWeather[]): Record<number, KkpWeatherCategory> {
  const out: Record<number, KkpWeatherCategory> = {};
  for (const h of hours) out[h.hour] = h.category;
  return out;
}
