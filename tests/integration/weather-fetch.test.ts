// CUACA OTOMATIS PER JAM (DECISIONS 176) — yang diuji di sini adalah ATURAN,
// bukan layanan luarnya: penyedia di-mock supaya test deterministik & tidak
// menembak jaringan dari CI.
//
//   1. pengambilan mengisi 15 kolom jam blanko + meringkas ke satu WeatherCode;
//   2. panggilan kedua memakai CACHE (tidak menembak penyedia lagi);
//   3. isian MANUAL orang lapangan tidak boleh ditimpa otomatis;
//   4. laporan yang sudah final/disetujui tidak bisa diubah cuacanya;
//   5. lokasi tanpa koordinat ditolak dengan pesan yang bisa ditindaklanjuti;
//   6. memilih cuaca manual membuang deret per jam yang tidak lagi sepadan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let providerCalls = 0;
/** Hujan jam 13–15, sisanya cerah. */
vi.mock("@/lib/weather/open-meteo", () => ({
  WEATHER_PROVIDER: "open-meteo-mock",
  WeatherFetchError: class WeatherFetchError extends Error {},
  fetchHourlyWeather: async () => {
    providerCalls++;
    return [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour) => ({
      hour,
      category: hour >= 13 && hour <= 15 ? ("Hujan" as const) : ("Cerah" as const),
      precipMm: hour >= 13 && hour <= 15 ? 2.5 : 0,
      code: hour >= 13 && hour <= 15 ? 61 : 0,
    }));
  },
}));

const { db } = await import("@/lib/db");
const { applyWeatherToReport, getObservation, WeatherError } = await import("@/lib/weather/service");
const { getOrCreateDraft, setEnrichment } = await import("@/lib/daily-report/service");
const { parseHourlyWeather } = await import("@/lib/weather/hourly");

const suffix = `wx${Date.now().toString(36)}`;
const DATE_KEY = "2026-07-20";
let locationId: string;
let locationNoGpsId: string;
let userId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org WX ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `wx-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket WX ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi WX",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      gpsLat: -8.4,
      gpsLng: 114.3,
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const locNoGps = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Tanpa Koordinat",
      slug: `lokasi-nogps-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
    },
  });
  locationNoGpsId = locNoGps.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("pengambilan cuaca otomatis", () => {
  it("mengisi 15 jam blanko + meringkas jadi satu WeatherCode", async () => {
    const report = await getOrCreateDraft(locationId, DATE_KEY, userId);
    const result = await applyWeatherToReport(report.id);

    expect(result.hours).toHaveLength(15);
    expect(result.hours.filter((h) => h.category === "Hujan").map((h) => h.hour)).toEqual([13, 14, 15]);
    expect(result.weather).toBe("hujan_ringan"); // 2,5 mm/jam → ringan, bukan deras

    const saved = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(saved.weatherSource).toBe("otomatis");
    expect(saved.weatherFetchedAt).not.toBeNull();
    expect(parseHourlyWeather(saved.weatherHourly)).toHaveLength(15);
  });

  it("panggilan berikutnya memakai cache — penyedia tidak ditembak lagi", async () => {
    const before = providerCalls;
    const again = await getObservation(locationId, DATE_KEY);
    expect(again.cached).toBe(true);
    expect(providerCalls).toBe(before);

    // force → boleh menembak lagi (dipakai tombol "muat ulang").
    await getObservation(locationId, DATE_KEY, { force: true });
    expect(providerCalls).toBe(before + 1);
  });

  it("lokasi tanpa koordinat ditolak dengan pesan yang bisa ditindaklanjuti", async () => {
    const report = await getOrCreateDraft(locationNoGpsId, DATE_KEY, userId);
    await expect(applyWeatherToReport(report.id)).rejects.toThrow(/koordinat/i);
  });
});

describe("pengamatan lapangan menang atas data otomatis", () => {
  it("cuaca yang dipilih manual tidak bisa ditimpa otomatis tanpa persetujuan", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-19", userId);
    await setEnrichment(
      report.id,
      {
        weather: "angin_kencang", // kejadian lokal yang TIDAK pernah dihasilkan otomatis
        workStart: null,
        workEnd: null,
        notes: null,
        workers: [],
        materials: [],
        equipment: [],
      },
      userId,
    );

    const manual = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(manual.weatherSource).toBe("manual");

    await expect(applyWeatherToReport(report.id)).rejects.toThrow(WeatherError);
    const stillManual = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(stillManual.weather).toBe("angin_kencang");

    // Tombol ditekan sadar (overwriteManual) → baru boleh berganti.
    await applyWeatherToReport(report.id, { overwriteManual: true });
    const now = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(now.weatherSource).toBe("otomatis");
    expect(now.weather).toBe("hujan_ringan");
  });

  it("memilih cuaca manual yang berbeda MEMBUANG deret per jam (blanko tidak bercerita dua versi)", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-18", userId);
    await applyWeatherToReport(report.id);
    expect(parseHourlyWeather((await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } })).weatherHourly))
      .toHaveLength(15);

    await setEnrichment(
      report.id,
      { weather: "cerah", workStart: null, workEnd: null, notes: null, workers: [], materials: [], equipment: [] },
      userId,
    );
    const after = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.weatherSource).toBe("manual");
    expect(after.weatherHourly).toBeNull(); // deret otomatis (hujan_ringan) tak lagi sepadan
  });

  it("cuaca manual yang SEPADAN dengan deret otomatis tidak membuang deretnya", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-17", userId);
    await applyWeatherToReport(report.id);
    await setEnrichment(
      report.id,
      { weather: "hujan_ringan", workStart: null, workEnd: null, notes: null, workers: [], materials: [], equipment: [] },
      userId,
    );
    const after = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(parseHourlyWeather(after.weatherHourly)).toHaveLength(15);
  });
});

describe("pemilih cuaca manual dimatikan (DECISIONS 177)", () => {
  it("menyimpan pelengkap KKP TANPA field cuaca tidak menghapus hasil ambil otomatis", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-15", userId);
    await applyWeatherToReport(report.id);

    // Form tanpa pemilih manual tidak mengirim `weather` sama sekali →
    // input.weather undefined. Dulu ini akan mengosongkan cuaca tiap simpan.
    await setEnrichment(
      report.id,
      { workStart: "08:00", workEnd: "17:00", notes: null, workers: [], materials: [], equipment: [] },
      userId,
    );

    const after = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.weather).toBe("hujan_ringan");
    expect(after.weatherSource).toBe("otomatis");
    expect(parseHourlyWeather(after.weatherHourly)).toHaveLength(15);
    expect(after.workStart).toBe("08:00"); // field lain tetap tersimpan
  });

  it("cuaca null EKSPLISIT tetap bisa mengosongkan (jalur pemilih manual bila dihidupkan lagi)", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-14", userId);
    await applyWeatherToReport(report.id);
    await setEnrichment(
      report.id,
      { weather: null, workStart: null, workEnd: null, notes: null, workers: [], materials: [], equipment: [] },
      userId,
    );
    const after = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.weather).toBeNull();
    expect(after.weatherSource).toBeNull();
    expect(after.weatherHourly).toBeNull();
  });
});

describe("laporan terkunci", () => {
  it("laporan disetujui/final tidak bisa diubah cuacanya", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-16", userId);
    await db.dailyReport.update({ where: { id: report.id }, data: { status: "final" } });
    await expect(applyWeatherToReport(report.id)).rejects.toThrow(/final/i);
  });
});
