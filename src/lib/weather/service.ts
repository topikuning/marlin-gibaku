import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import {
  dominantWeatherCode,
  parseHourlyWeather,
  type HourlyWeather,
} from "@/lib/weather/hourly";
import { fetchHourlyWeather, WEATHER_PROVIDER, WeatherFetchError } from "@/lib/weather/open-meteo";
import type { Prisma } from "@/generated/prisma/client";
import type { WeatherCode } from "@/generated/prisma/enums";

/**
 * Pengambilan cuaca per jam untuk laporan harian: cache DB dulu, panggil
 * penyedia hanya bila belum ada. 83 lokasi × 1 panggilan/hari.
 *
 * ATURAN yang dijaga di sini:
 * - Isian MANUAL orang lapangan TIDAK PERNAH ditimpa otomatis (pengamatan
 *   menang atas model).
 * - Laporan yang sudah `disetujui`/`final` tidak boleh berubah.
 * - Gagal ambil = pesan ramah, JANGAN memblokir pengisian laporan.
 */

export { WeatherFetchError };

export class WeatherError extends Error {}

/** Status laporan yang isian cuacanya masih boleh berubah. */
const FILLABLE_STATUSES = ["draft", "perlu_koreksi", "dikirim"] as const;

export type WeatherApplyResult = {
  hours: HourlyWeather[];
  weather: WeatherCode | null;
  cached: boolean;
};

/**
 * Ambil pengamatan per jam untuk (lokasi, tanggal) — dari cache bila ada.
 * `force` mengabaikan cache (dipakai bila user minta muat ulang).
 */
export async function getObservation(
  locationId: string,
  dateKey: string,
  opts: { force?: boolean } = {},
): Promise<{ hours: HourlyWeather[]; cached: boolean }> {
  const observedOn = parseDateKey(dateKey);
  if (!observedOn) throw new WeatherError("Tanggal tidak valid.");

  if (!opts.force) {
    const cached = await db.weatherObservation.findUnique({
      where: { locationId_observedOn: { locationId, observedOn } },
      select: { hourly: true },
    });
    const hours = cached ? parseHourlyWeather(cached.hourly) : null;
    if (hours) return { hours, cached: true };
  }

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { gpsLat: true, gpsLng: true, name: true },
  });
  if (!location) throw new WeatherError("Lokasi tidak ditemukan.");
  if (location.gpsLat == null || location.gpsLng == null) {
    throw new WeatherError(
      `Lokasi "${location.name}" belum punya koordinat GPS – isi koordinat di data lokasi dulu, atau pilih cuaca manual.`,
    );
  }

  const lat = Number(location.gpsLat);
  const lng = Number(location.gpsLng);
  const hours = await fetchHourlyWeather({
    lat,
    lng,
    dateKey,
    todayKey: jakartaDateKey(new Date()),
  });

  await db.weatherObservation.upsert({
    where: { locationId_observedOn: { locationId, observedOn } },
    create: {
      locationId,
      observedOn,
      provider: WEATHER_PROVIDER,
      lat,
      lng,
      hourly: hours as unknown as Prisma.InputJsonValue,
    },
    update: {
      provider: WEATHER_PROVIDER,
      lat,
      lng,
      hourly: hours as unknown as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  });

  return { hours, cached: false };
}

/**
 * Isi kolom cuaca laporan harian dari pengamatan. Menolak bila laporan sudah
 * dikunci, atau bila cuacanya sudah diisi MANUAL (kecuali `overwriteManual`,
 * yang hanya dipakai bila user menekan tombolnya sendiri secara sadar).
 */
export async function applyWeatherToReport(
  reportId: string,
  opts: { force?: boolean; overwriteManual?: boolean } = {},
): Promise<WeatherApplyResult> {
  const report = await db.dailyReport.findUnique({
    where: { id: reportId },
    select: { id: true, locationId: true, reportDate: true, status: true, weatherSource: true },
  });
  if (!report) throw new WeatherError("Laporan tidak ditemukan.");
  if (!FILLABLE_STATUSES.includes(report.status as (typeof FILLABLE_STATUSES)[number])) {
    throw new WeatherError("Laporan sudah disetujui/final – cuaca tidak bisa diubah lagi.");
  }
  if (report.weatherSource === "manual" && !opts.overwriteManual) {
    throw new WeatherError("Cuaca sudah diisi manual dari lapangan – isian itu yang dipakai.");
  }

  const dateKey = jakartaDateKey(report.reportDate);
  const { hours, cached } = await getObservation(report.locationId, dateKey, { force: opts.force });
  const weather = dominantWeatherCode(hours);

  await db.dailyReport.update({
    where: { id: reportId },
    data: {
      weatherHourly: hours as unknown as Prisma.InputJsonValue,
      weather,
      weatherSource: "otomatis",
      weatherFetchedAt: new Date(),
    },
  });

  return { hours, weather, cached };
}
