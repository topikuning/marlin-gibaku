import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import {
  dominantWeatherCode,
  parseHourlyWeather,
  type HourlyWeather,
} from "@/lib/weather/hourly";
import { fetchHourlyWeather, WEATHER_PROVIDER, WeatherFetchError } from "@/lib/weather/open-meteo";
import { fetchHourlySatelit, SATELIT_PROVIDER, SatelitError } from "@/lib/weather/satelit";
import { getSumberCuaca, type SumberCuaca } from "@/lib/weather/setelan";
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
  sumber: SumberCuaca;
  /** Keterangan jam yang dibiarkan kosong dan sebabnya (sumber satelit). */
  catatan: string[];
};

/**
 * Simpanan cuaca satelit dianggap TUNTAS bila lima belas jamnya lengkap, atau
 * bila diambil ≥ 6 jam sesudah hari itu selesai (GSMaP tertunda ±4 jam).
 * Selain itu diambil ulang: hari yang belum lengkap tidak boleh membeku.
 */
function satelitTuntas(dateKey: string, fetchedAt: Date, hours: HourlyWeather[]): boolean {
  if (hours.length >= 15) return true;
  return fetchedAt.getTime() >= Date.parse(`${dateKey}T22:00:00+07:00`) + 6 * 3_600_000;
}

function rentangJam(jam: number[]): string {
  return jam.map((h) => `${String(h).padStart(2, "0")}.00`).join(", ");
}

/**
 * Ambil pengamatan per jam untuk (lokasi, tanggal) — dari cache bila ada.
 * `force` mengabaikan cache (dipakai bila user minta muat ulang).
 */
export async function getObservation(
  locationId: string,
  dateKey: string,
  opts: { force?: boolean } = {},
): Promise<{ hours: HourlyWeather[]; cached: boolean; sumber: SumberCuaca; catatan: string[] }> {
  const observedOn = parseDateKey(dateKey);
  if (!observedOn) throw new WeatherError("Tanggal tidak valid.");
  const sumber = await getSumberCuaca();
  const provider = sumber === "satelit" ? SATELIT_PROVIDER : WEATHER_PROVIDER;

  if (!opts.force) {
    const cached = await db.weatherObservation.findUnique({
      where: { locationId_observedOn: { locationId, observedOn } },
      select: { hourly: true, provider: true, fetchedAt: true },
    });
    // Simpanan dari sumber lain tidak dipakai: ganti sumber = ambil ulang.
    const hours = cached && cached.provider === provider ? parseHourlyWeather(cached.hourly) : null;
    if (hours && (sumber !== "satelit" || satelitTuntas(dateKey, cached!.fetchedAt, hours))) {
      return { hours, cached: true, sumber, catatan: [] };
    }
  }

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { gpsLat: true, gpsLng: true, name: true },
  });
  if (!location) throw new WeatherError("Lokasi tidak ditemukan.");
  if (location.gpsLat == null || location.gpsLng == null) {
    throw new WeatherError(
      `Lokasi "${location.name}" belum punya koordinat GPS. Isi dulu koordinatnya di data lokasi, atau isi cuaca secara manual.`,
    );
  }

  const lat = Number(location.gpsLat);
  const lng = Number(location.gpsLng);
  let hours: HourlyWeather[];
  const catatan: string[] = [];
  if (sumber === "satelit") {
    let hasil;
    try {
      hasil = await fetchHourlySatelit({ locationId, lat, lng, dateKey, sekarang: new Date() });
    } catch (e) {
      if (e instanceof SatelitError) throw new WeatherFetchError(e.message);
      throw new WeatherFetchError(`Data satelit gagal diambil: ${e instanceof Error ? e.message : String(e)}`);
    }
    hours = hasil.hours;
    if (hasil.belumTerjadi.length > 0) {
      catatan.push(`${hasil.belumTerjadi.length} jam belum terjadi, dibiarkan kosong.`);
    }
    if (hasil.kosong.length > 0) {
      catatan.push(`Jam ${rentangJam(hasil.kosong)} dibiarkan kosong karena datanya belum cukup.`);
    }
    catatan.push(...hasil.catatan);
  } else {
    hours = await fetchHourlyWeather({
      lat,
      lng,
      dateKey,
      todayKey: jakartaDateKey(new Date()),
    });
  }

  await db.weatherObservation.upsert({
    where: { locationId_observedOn: { locationId, observedOn } },
    create: {
      locationId,
      observedOn,
      provider,
      lat,
      lng,
      hourly: hours as unknown as Prisma.InputJsonValue,
      // Jam aplikasi, bukan jam database: penentu "tuntas" membandingkannya.
      fetchedAt: new Date(),
    },
    update: {
      provider,
      lat,
      lng,
      hourly: hours as unknown as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  });

  return { hours, cached: false, sumber, catatan };
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
    throw new WeatherError("Laporan sudah disetujui atau final, jadi cuacanya tidak bisa diubah lagi.");
  }
  if (report.weatherSource === "manual" && !opts.overwriteManual) {
    throw new WeatherError("Cuaca sudah diisi manual dari lapangan, jadi isian itulah yang dipakai.");
  }

  const dateKey = jakartaDateKey(report.reportDate);
  const { hours, cached, sumber, catatan } = await getObservation(report.locationId, dateKey, { force: opts.force });
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

  return { hours, weather, cached, sumber, catatan };
}
