// SUMBER CUACA SATELIT (DECISIONS baru 2026-10-07).
//
// Keputusan user: *"proses gsmap dan himawari, buat ada opsi di sistem gunakan
// meteo atau baru ini"*. Pembaca jaringan (Himawari, GSMaP, Open-Meteo)
// di-mock; yang diuji ATURANNYA lewat jalur sungguhan `applyWeatherToReport`:
//   1. tanpa setelan → Open-Meteo, persis seperti sebelumnya;
//   2. setelan "satelit" → awan Himawari + hujan GSMaP, Open-Meteo tidak disentuh;
//      simpanan Open-Meteo lama untuk tanggal yang sama tidak dipakai;
//   3. jam yang belum lewat dan jam tanpa data cukup DIBIARKAN KOSONG dan disebut;
//   4. hari yang belum lengkap diambil ulang, hari yang tuntas memakai simpanan;
//   5. tanpa akun GSMaP: hanya jam yang langitnya nyaris bersih yang terisi.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let panggilOm = 0;
vi.mock("@/lib/weather/open-meteo", () => ({
  WEATHER_PROVIDER: "open-meteo",
  WeatherFetchError: class WeatherFetchError extends Error {},
  fetchHourlyWeather: async () => {
    panggilOm++;
    return [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour) => ({
      hour,
      category: "Cerah" as const,
      precipMm: 0,
      code: 0,
    }));
  },
}));

/** Awan per jam UTC: pagi bersih, siang berawan, sore penuh. */
const AWAN: Record<number, number | null> = { 0: 0, 1: 10, 2: 30, 3: 60, 4: 80, 5: 100, 6: 100, 7: 100, 8: 90, 9: 40, 10: 5, 11: 0, 12: null, 13: 70, 14: 100 };
/** Hujan per jam UTC (mm); jam di atas `gsmapSampai` dianggap belum terbit. */
const HUJAN: Record<number, number> = { 6: 3.2, 7: 8, 8: 0.3 };
let gsmapSampai = 14;
let akunGsmap = true;
let panggilAwan = 0;

/** Berkas satelit yang dibuka, per jam: "awan|tanggal|jamUtc" / "hujan|…". */
const dibuka: string[] = [];

vi.mock("@/lib/weather/himawari", () => ({
  HIMAWARI_PROVIDER: "himawari-mock",
  awanHimawariBanyak: async (t: string, jam: number, titik: { id: string }[]) => {
    panggilAwan++;
    dibuka.push(`awan|${t}|${jam}`);
    return new Map(titik.map((x) => [x.id, AWAN[jam] ?? null]));
  },
}));
vi.mock("@/lib/weather/gsmap", () => {
  class GsmapBelumSiapError extends Error {}
  return {
    GSMAP_PROVIDER: "gsmap-mock",
    GsmapBelumSiapError,
    gsmapSiap: async () => akunGsmap,
    bukaGsmap: async () => {
      if (!akunGsmap) throw new GsmapBelumSiapError("Akun GSMaP belum diisi (Sistem → Pekerjaan Harian → Sumber cuaca otomatis).");
      return {
        unduh: async (daftar: { tanggalUtc: string; jamUtc: number }[]) =>
          new Set(daftar.filter((j) => j.jamUtc <= gsmapSampai).map((j) => `${j.tanggalUtc}|${j.jamUtc}`)),
        hujanBanyak: async (t: string, jam: number, titik: { id: string }[]) => {
          if (jam > gsmapSampai) return undefined;
          dibuka.push(`hujan|${t}|${jam}`);
          return new Map(titik.map((x) => [x.id, HUJAN[jam] ?? 0]));
        },
        tutup: async () => undefined,
      };
    },
  };
});

const { db } = await import("@/lib/db");
const { applyWeatherToReport } = await import("@/lib/weather/service");
const { getOrCreateDraft } = await import("@/lib/daily-report/service");
const { setSumberCuaca, SUMBER_CUACA_KEY } = await import("@/lib/weather/setelan");
const { SATELIT_PROVIDER, mulaiCuacaSatelitLatar, tungguCuacaSatelitLatar } = await import("@/lib/weather/satelit");

const suffix = `cs${Date.now().toString(36)}`;
let locationId = "";
let userId = "";

beforeAll(async () => {
  await db.appSetting.deleteMany({ where: { key: SUMBER_CUACA_KEY } });
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `u-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  locationId = (
    await db.location.create({
      data: {
        packageId: pkg.id, name: "Lokasi Satelit", slug: `lok-${suffix}`, village: "Desa", regency: "Batang",
        province: "Jawa Tengah", gpsLat: -6.92, gpsLng: 109.73, status: "berjalan", isActive: true,
      },
    })
  ).id;
});

afterEach(() => {
  vi.useRealTimers();
  gsmapSampai = 14;
  akunGsmap = true;
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: SUMBER_CUACA_KEY } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const kategori = (hours: { hour: number; category: string }[]) =>
  Object.fromEntries(hours.map((h) => [h.hour, h.category]));

describe("pilihan sumber cuaca", () => {
  it("tanpa setelan: Open-Meteo, seperti sebelumnya", async () => {
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.sumber).toBe("open-meteo");
    expect(hasil.hours).toHaveLength(15);
    expect(panggilOm).toBe(1);
  });

  it("setelan satelit: awan + hujan, simpanan Open-Meteo tanggal yang sama tidak dipakai", async () => {
    await setSumberCuaca("satelit");
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.sumber).toBe("satelit");
    expect(panggilOm).toBe(1);
    // 07–08 WIB bersih → Cerah; 10 WIB awan 60% → Mendung; 13–15 WIB hujan
    // (3,2 / 8 mm); 15 WIB 0,3 mm di bawah ambang → Mendung (awan 90%);
    // 19 WIB tanpa data awan → kosong.
    expect(kategori(hasil.hours)).toMatchObject({
      7: "Cerah", 8: "Cerah", 9: "Cerah", 10: "Mendung", 11: "Mendung",
      13: "Hujan", 14: "Hujan", 15: "Mendung", 16: "Cerah", 17: "Cerah", 18: "Cerah", 20: "Mendung", 21: "Mendung",
    });
    expect(hasil.hours.find((h) => h.hour === 19)).toBeUndefined();
    expect(hasil.hours.find((h) => h.hour === 14)).toMatchObject({ precipMm: 8, code: 65, cloudPct: 100 });
    expect(hasil.weather).toBe("hujan_deras");
    expect(hasil.catatan.join(" ")).toMatch(/Jam 19\.00 dibiarkan kosong/);

    const obs = await db.weatherObservation.findFirstOrThrow({ where: { locationId, observedOn: new Date("2026-09-01T00:00:00Z") } });
    expect(obs.provider).toBe(SATELIT_PROVIDER);
  });

  it("hari yang sudah lewat lama dianggap tuntas: tidak diambil ulang walau satu jam kosong", async () => {
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const sebelum = panggilAwan;
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.cached).toBe(true);
    expect(panggilAwan).toBe(sebelum);
  });

  it("hari berjalan: jam yang belum lewat kosong, hujan yang belum terbit disebut, lalu diambil ulang", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T15:20:00+07:00"));
    gsmapSampai = 5; // hujan baru terbit sampai 12 WIB
    const r = await getOrCreateDraft(locationId, "2026-09-02", userId);
    const a = await applyWeatherToReport(r.id);
    // 07–14 WIB sudah lewat; 15–21 belum terjadi.
    expect(a.hours.every((h) => h.hour <= 14)).toBe(true);
    expect(a.catatan.join(" ")).toMatch(/7 jam belum terjadi/);
    expect(a.catatan.join(" ")).toMatch(/2 jam data hujan GSMaP belum terbit/);
    // 13–14 WIB berawan penuh tanpa data hujan → kosong, BUKAN Mendung.
    expect(a.hours.find((h) => h.hour === 13)).toBeUndefined();

    vi.setSystemTime(new Date("2026-09-03T06:00:00+07:00"));
    gsmapSampai = 14;
    const b = await applyWeatherToReport(r.id);
    expect(b.cached).toBe(false);
    expect(kategori(b.hours)).toMatchObject({ 13: "Hujan", 14: "Hujan", 21: "Mendung" });
  });

  it("tanpa akun GSMaP: hanya jam yang langitnya nyaris bersih yang terisi, dan sebabnya disebut", async () => {
    akunGsmap = false;
    const r = await getOrCreateDraft(locationId, "2026-09-04", userId);
    const hasil = await applyWeatherToReport(r.id);
    expect(Object.keys(kategori(hasil.hours)).map(Number).sort((x, y) => x - y)).toEqual([7, 8, 17, 18]);
    expect(hasil.hours.every((h) => h.category === "Cerah")).toBe(true);
    expect(hasil.catatan.join(" ")).toMatch(/Akun GSMaP belum diisi/);
  });

  it("kembali ke Open-Meteo: simpanan satelit tidak dipakai", async () => {
    await setSumberCuaca("open-meteo");
    const r = await getOrCreateDraft(locationId, "2026-09-04", userId);
    const sebelum = panggilOm;
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.sumber).toBe("open-meteo");
    expect(panggilOm).toBe(sebelum + 1);
  });

  it("bacaan yang sudah tersimpan tidak diambil ulang – hanya jam yang belum ada", async () => {
    await setSumberCuaca("satelit");
    // Simpanan kategori dihapus: yang tersisa hanya bacaan mentah per jam.
    await db.weatherObservation.deleteMany({ where: { locationId } });
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const sebelum = dibuka.length;
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.cached).toBe(false);
    expect(dibuka.length).toBe(sebelum);
    expect(kategori(hasil.hours)).toMatchObject({ 13: "Hujan", 14: "Hujan", 15: "Mendung" });
  });

  it("pengisian latar: satu berkas per jam melayani SEMUA lokasi, untuk kemarin dan hari ini", async () => {
    await setSumberCuaca("satelit");
    const pkg = await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { packageId: true } });
    const lain = await db.location.create({
      data: {
        packageId: pkg.packageId, name: "Lokasi Satelit 2", slug: `lok2-${suffix}`, village: "Desa", regency: "Batang",
        province: "Jawa Tengah", gpsLat: -6.95, gpsLng: 109.8, status: "berjalan", isActive: true,
      },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T12:30:00+07:00"));
    dibuka.length = 0;
    expect(await mulaiCuacaSatelitLatar()).toEqual({ dimulai: true });
    await tungguCuacaSatelitLatar();
    const awanKemarin = dibuka.filter((x) => x.startsWith("awan|2026-09-10|"));
    expect(awanKemarin).toHaveLength(15);
    expect(new Set(awanKemarin).size).toBe(15);
    // Hari ini 12.30 WIB: jam 07–11 sudah lewat.
    expect(dibuka.filter((x) => x.startsWith("awan|2026-09-11|"))).toHaveLength(5);
    for (const id of [locationId, lain.id]) {
      expect(
        await db.cuacaSatelitJam.count({ where: { locationId: id, tanggal: new Date("2026-09-10T00:00:00Z"), awanDiambil: { not: null } } }),
      ).toBe(15);
    }
    // Putaran berikutnya tanpa jam baru: tidak membuka berkas apa pun.
    dibuka.length = 0;
    await mulaiCuacaSatelitLatar();
    await tungguCuacaSatelitLatar();
    expect(dibuka).toEqual([]);
  });

  it("sumber Open-Meteo: pengisian latar tidak berjalan", async () => {
    await setSumberCuaca("open-meteo");
    expect(await mulaiCuacaSatelitLatar()).toMatchObject({ dimulai: false });
  });
});
