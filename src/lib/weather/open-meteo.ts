import "server-only";
import { z } from "zod";
import { buildHourlyWeather, type HourlyWeather } from "@/lib/weather/hourly";

/**
 * Klien Open-Meteo — pengisi kolom jam blanko KKP.
 *
 * Kenapa endpoint `forecast` dan bukan `archive`: laporan harian diisi di ujung
 * hari yang SAMA (atau H+1). Parameter `past_days` mengembalikan jam-jam yang
 * sudah lewat dari analisis model (gabungan observasi + model) — arsip ERA5
 * tertinggal beberapa hari sehingga tidak berguna untuk hari berjalan.
 *
 * Tidak butuh API key. Base URL bisa ditimpa lewat env `WEATHER_API_URL` (uji
 * coba / mirror berbayar bila nanti dibutuhkan lisensi komersial).
 *
 * ATURAN: modul ini HANYA mengambil & memvalidasi data. Pemetaan ke kategori
 * blanko ada di `weather/hourly.ts`, penyimpanan di `weather/service.ts`.
 */

export class WeatherFetchError extends Error {}

const DEFAULT_BASE = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8000;
/** Batas mundur yang masih dilayani endpoint forecast. */
const MAX_PAST_DAYS = 60;

const responseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()),
    precipitation: z.array(z.number().nullable()),
  }),
});

export const WEATHER_PROVIDER = "open-meteo";

function baseUrl(): string {
  return process.env.WEATHER_API_URL?.trim() || DEFAULT_BASE;
}

/**
 * Ambil kondisi per jam untuk SATU tanggal (Asia/Jakarta) pada koordinat lokasi.
 * `dateKey` = "YYYY-MM-DD" waktu Jakarta. `todayKey` dipakai menghitung
 * `past_days` — diserahkan pemanggil supaya fungsi ini tetap deterministik.
 */
export async function fetchHourlyWeather(args: {
  lat: number;
  lng: number;
  dateKey: string;
  todayKey: string;
}): Promise<HourlyWeather[]> {
  const daysBack = Math.round(
    (Date.parse(`${args.todayKey}T00:00:00Z`) - Date.parse(`${args.dateKey}T00:00:00Z`)) / 86_400_000,
  );
  if (daysBack < 0) throw new WeatherFetchError("Tanggal di masa depan – cuaca hanya untuk hari yang sudah berjalan.");
  if (daysBack > MAX_PAST_DAYS)
    throw new WeatherFetchError(`Tanggal lebih dari ${MAX_PAST_DAYS} hari lalu – data per jam tidak tersedia.`);

  const url = new URL(baseUrl());
  url.searchParams.set("latitude", args.lat.toFixed(4));
  url.searchParams.set("longitude", args.lng.toFixed(4));
  url.searchParams.set("hourly", "weather_code,precipitation");
  url.searchParams.set("timezone", "Asia/Jakarta");
  url.searchParams.set("past_days", String(Math.min(MAX_PAST_DAYS, Math.max(1, daysBack + 1))));
  url.searchParams.set("forecast_days", "1");

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    throw new WeatherFetchError(
      e instanceof Error && e.name === "TimeoutError"
        ? "Layanan cuaca tidak menjawab (timeout)."
        : "Tidak bisa menghubungi layanan cuaca.",
    );
  }
  if (!res.ok) throw new WeatherFetchError(`Layanan cuaca menolak permintaan (HTTP ${res.status}).`);

  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new WeatherFetchError("Balasan layanan cuaca tidak dikenali.");

  const hours = buildHourlyWeather(
    {
      time: parsed.data.hourly.time,
      weatherCode: parsed.data.hourly.weather_code,
      precipitation: parsed.data.hourly.precipitation,
    },
    args.dateKey,
  );
  if (hours.length === 0) throw new WeatherFetchError("Layanan cuaca tidak punya data jam untuk tanggal itu.");
  return hours;
}
