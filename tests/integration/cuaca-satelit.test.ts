// CUACA: TOMBOL OPEN-METEO, PEMBARUAN SATELIT SENYAP PUKUL 04.00 WIB
// (DECISIONS 655, 657).
//
// Permintaan user: *"saat user klik di inputan laporan harian, datanya
// sementara diambil dari meteo. tapi saat 4 dini hari WIB, data diperbarui
// dengan data dari gsmap dan himawari kalau memang data dari dua sumber ini
// lebih valid, senyap tapi data tetap terisi dengan valid … coba kamu pastikan
// upload auto google drivenya juga"*.
//
// Pembaca jaringan (Himawari, GSMaP, Open-Meteo) di-mock; yang diuji ATURANNYA:
//   1. tombol selalu Open-Meteo, satelit tidak disentuh;
//   2. pukul 04.00: per jam, satelit dipakai di jam yang bisa disimpulkan,
//      Open-Meteo di jam lain; tercatat asal tiap jam, audit, dan simpanan;
//   3. tombol sesudahnya memakai hasil gabungan, tidak menimpanya;
//   4. isian manual & laporan disetujui/final tidak disentuh, laporan kosong
//      diisi, satu berkas satelit per jam untuk semua lokasi;
//   5. diulang tidak menulis/mengaudit lagi;
//   6. penjadwal: belum 04.00 = belum kemarin, yang terlewat disusul,
//      sakelar mati = diam;
//   7. tanpa akun GSMaP: data hujan tidak dipakai dan disebut;
//   8. snapshot final – yang diunggah otomatis ke Google Drive – membawa
//      hasil gabungan.
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
/** Model: mendung seharian, hujan pukul 20–21 WIB. */
vi.mock("@/lib/weather/open-meteo", () => ({
  WEATHER_PROVIDER: "open-meteo",
  WeatherFetchError: class WeatherFetchError extends Error {},
  fetchHourlyWeather: async () => {
    panggilOm++;
    return [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour) => ({
      hour,
      category: hour >= 20 ? ("Hujan" as const) : ("Mendung" as const),
      precipMm: hour >= 20 ? 1.5 : 0,
      code: hour >= 20 ? 61 : 3,
    }));
  },
}));

/** Awan per jam UTC (07 WIB = 00 UTC): pagi bersih, siang berawan, sore penuh. */
const AWAN: Record<number, number | null> = { 0: 0, 1: 10, 2: 30, 3: 60, 4: 80, 5: 100, 6: 100, 7: 100, 8: 90, 9: 40, 10: 5, 11: 0, 12: null, 13: 70, 14: 100 };
/** Hujan per jam UTC (mm). */
const HUJAN: Record<number, number> = { 6: 3.2, 7: 8, 8: 0.3 };
let akunGsmap = true;
/** Berkas satelit yang dibuka: "awan|tanggal|jamUtc" / "hujan|…". */
const dibuka: string[] = [];

vi.mock("@/lib/weather/himawari", () => ({
  HIMAWARI_PROVIDER: "himawari-mock",
  awanHimawariBanyak: async (t: string, jam: number, titik: { id: string }[]) => {
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
      if (!akunGsmap) throw new GsmapBelumSiapError("Akun GSMaP belum diisi.");
      return {
        unduh: async (daftar: { tanggalUtc: string; jamUtc: number }[]) =>
          new Set(daftar.map((j) => `${j.tanggalUtc}|${j.jamUtc}`)),
        hujanBanyak: async (t: string, jam: number, titik: { id: string }[]) => {
          dibuka.push(`hujan|${t}|${jam}`);
          return new Map(titik.map((x) => [x.id, HUJAN[jam] ?? 0]));
        },
        tutup: async () => undefined,
      };
    },
  };
});

const { db } = await import("@/lib/db");
const { applyWeatherToReport, GABUNGAN_PROVIDER } = await import("@/lib/weather/service");
const { getOrCreateDraft, finalizeReport } = await import("@/lib/daily-report/service");
const { setSatelitSubuhAktif, SATELIT_SUBUH_KEY, SATELIT_SUBUH_TANGGAL_KEY, SATELIT_SUBUH_TERAKHIR_KEY } = await import(
  "@/lib/weather/setelan"
);
const { perbaruiCuacaSubuh, perbaruiCuacaTanggal } = await import("@/lib/weather/subuh");
const { parseHourlyWeather } = await import("@/lib/weather/hourly");

const KUNCI = () => [SATELIT_SUBUH_KEY, SATELIT_SUBUH_TANGGAL_KEY, SATELIT_SUBUH_TERAKHIR_KEY];
const suffix = `cs${Date.now().toString(36)}`;
let packageId = "";
let locationId = "";
let userId = "";

async function lokasiBaru(nama: string): Promise<string> {
  return (
    await db.location.create({
      data: {
        packageId, name: nama, slug: `${nama.toLowerCase().replace(/\s+/g, "-")}-${suffix}`, village: "Desa",
        regency: "Batang", province: "Jawa Tengah", gpsLat: -6.92, gpsLng: 109.73, status: "berjalan", isActive: true,
      },
    })
  ).id;
}

beforeAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: KUNCI() } } });
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `u-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  packageId = (await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } })).id;
  locationId = await lokasiBaru("Lokasi Satelit");
});

afterEach(() => {
  vi.useRealTimers();
  akunGsmap = true;
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: KUNCI() } } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const kategori = (hours: { hour: number; category: string }[]) =>
  Object.fromEntries(hours.map((h) => [h.hour, h.category]));
const laporan = (id: string) => db.dailyReport.findUniqueOrThrow({ where: { id } });

/** Hasil gabungan yang diharapkan untuk data mock di atas. */
const GABUNG = {
  7: "Cerah", 8: "Cerah", 9: "Cerah", 10: "Mendung", 11: "Mendung", 12: "Mendung",
  13: "Hujan", 14: "Hujan", 15: "Mendung", 16: "Cerah", 17: "Cerah", 18: "Cerah",
  19: "Mendung", 20: "Mendung", 21: "Mendung",
};

describe("tombol ambil cuaca", () => {
  it("selalu Open-Meteo, satelit tidak disentuh", async () => {
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.diperbarui).toBe(false);
    expect(hasil.hours).toHaveLength(15);
    expect(panggilOm).toBe(1);
    expect(dibuka).toEqual([]);
  });
});

describe("pembaruan pukul 04.00 WIB", () => {
  it("laporan kemarin diperbarui per jam: satelit bila bisa disimpulkan, Open-Meteo selebihnya", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T04:05:00+07:00"));
    const hasil = await perbaruiCuacaSubuh();
    expect(hasil).toMatchObject({ dijalankan: true });
    vi.useRealTimers();

    const r = await laporan((await getOrCreateDraft(locationId, "2026-09-01", userId)).id);
    const jam = parseHourlyWeather(r.weatherHourly)!;
    expect(kategori(jam)).toEqual(GABUNG);
    // 19 WIB: awan tidak terbaca → Open-Meteo. 20–21 WIB: model bilang hujan,
    // satelit mencatat awan tanpa hujan → pengamatan yang dipakai.
    expect(jam.find((h) => h.hour === 19)).toMatchObject({ sumber: "model" });
    expect(jam.find((h) => h.hour === 20)).toMatchObject({ sumber: "satelit", category: "Mendung" });
    expect(jam.find((h) => h.hour === 14)).toMatchObject({ sumber: "satelit", precipMm: 8, code: 65 });
    expect(r.weatherSource).toBe("otomatis");
    expect(r.weather).toBe("hujan_deras");

    const obs = await db.weatherObservation.findFirstOrThrow({ where: { locationId, observedOn: new Date("2026-09-01T00:00:00Z") } });
    expect(obs.provider).toBe(GABUNGAN_PROVIDER);
    const jejak = await db.auditLog.findFirstOrThrow({ where: { action: "daily_report.weather_subuh", resourceId: r.id } });
    expect(jejak.payload).toMatchObject({ tanggal: "2026-09-01", jamSatelit: 14, jamModel: 1 });
  });

  it("tombol sesudahnya memakai hasil gabungan, tidak menimpanya dengan Open-Meteo", async () => {
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    const sebelum = panggilOm;
    const hasil = await applyWeatherToReport(r.id);
    expect(hasil.diperbarui).toBe(true);
    expect(kategori(hasil.hours)).toEqual(GABUNG);
    expect(panggilOm).toBe(sebelum);
  });

  it("isian manual dan laporan disetujui tidak disentuh; laporan kosong diisi; satu berkas per jam untuk semua lokasi", async () => {
    const [lManual, lSetuju, lKosong] = [await lokasiBaru("Manual"), await lokasiBaru("Disetujui"), await lokasiBaru("Kosong")];
    const tgl = "2026-09-02";
    const manual = await getOrCreateDraft(lManual, tgl, userId);
    await db.dailyReport.update({ where: { id: manual.id }, data: { weather: "cerah", weatherSource: "manual" } });
    const setuju = await getOrCreateDraft(lSetuju, tgl, userId);
    await applyWeatherToReport(setuju.id);
    await db.dailyReport.update({ where: { id: setuju.id }, data: { status: "disetujui" } });
    const kosong = await getOrCreateDraft(lKosong, tgl, userId);
    const sebelumSetuju = (await laporan(setuju.id)).weatherHourly;

    dibuka.length = 0;
    const r = await perbaruiCuacaTanggal(tgl);
    expect(r).toMatchObject({ laporan: 1, diperbarui: 1 });
    expect(dibuka.filter((x) => x.startsWith(`awan|${tgl}|`))).toHaveLength(15);

    expect((await laporan(manual.id)).weatherSource).toBe("manual");
    expect((await laporan(manual.id)).weatherHourly).toBeNull();
    expect((await laporan(setuju.id)).weatherHourly).toEqual(sebelumSetuju);
    expect(kategori(parseHourlyWeather((await laporan(kosong.id)).weatherHourly)!)).toEqual(GABUNG);
  });

  it("diulang: tidak menulis dan tidak mengaudit lagi", async () => {
    const jejak = () => db.auditLog.count({ where: { action: "daily_report.weather_subuh" } });
    const sebelum = await jejak();
    const r = await perbaruiCuacaTanggal("2026-09-01");
    expect(r.diperbarui).toBe(0);
    expect(await jejak()).toBe(sebelum);
  });

  it("tanpa akun GSMaP: hujan satelit tidak dipakai, jam berawan tetap dari Open-Meteo, dan disebut", async () => {
    akunGsmap = false;
    const l = await lokasiBaru("Tanpa Akun");
    const tgl = "2026-09-05";
    const lap = await getOrCreateDraft(l, tgl, userId);
    await applyWeatherToReport(lap.id);
    const r = await perbaruiCuacaTanggal(tgl);
    expect(r.catatan.join(" ")).toMatch(/Akun GSMaP belum diisi/);
    const jam = parseHourlyWeather((await laporan(lap.id)).weatherHourly)!;
    // 07 WIB langit bersih → satelit; 13 WIB berawan penuh tanpa data hujan → model.
    expect(jam.find((h) => h.hour === 7)).toMatchObject({ category: "Cerah", sumber: "satelit" });
    expect(jam.find((h) => h.hour === 13)).toMatchObject({ category: "Mendung", sumber: "model" });
  });
});

describe("penjadwal", () => {
  it("belum 04.00 = kemarin belum diproses; sesudahnya diproses; yang sudah tidak diulang", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Penanda dari uji pertama: 2026-09-01.
    vi.setSystemTime(new Date("2026-09-04T03:30:00+07:00"));
    expect(await perbaruiCuacaSubuh()).toMatchObject({ dijalankan: true, tanggal: [{ tanggal: "2026-09-02" }] });
    vi.setSystemTime(new Date("2026-09-04T04:10:00+07:00"));
    expect(await perbaruiCuacaSubuh()).toMatchObject({ dijalankan: true, tanggal: [{ tanggal: "2026-09-03" }] });
    expect(await perbaruiCuacaSubuh()).toMatchObject({ dijalankan: false });
  });

  it("penjadwal mati beberapa hari: disusul paling jauh 3 hari", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-12T04:10:00+07:00"));
    const r = await perbaruiCuacaSubuh();
    expect(r.dijalankan && r.tanggal.map((t) => t.tanggal)).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
  });

  it("sakelar mati: tidak melakukan apa pun", async () => {
    await setSatelitSubuhAktif(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T04:10:00+07:00"));
    expect(await perbaruiCuacaSubuh()).toMatchObject({ dijalankan: false });
    await setSatelitSubuhAktif(true);
  });
});

describe("unggahan otomatis ke Google Drive", () => {
  it("snapshot final – yang dibaca unggahan Drive – membawa hasil pembaruan pukul 04.00", async () => {
    const r = await getOrCreateDraft(locationId, "2026-09-01", userId);
    await db.dailyReport.update({ where: { id: r.id }, data: { status: "disetujui" } });
    await finalizeReport(r.id, userId);
    const final = await laporan(r.id);
    expect(final.status).toBe("final");
    const snap = final.finalSnapshot as { weatherHourly: { hour: number; category: string }[] | null };
    expect(kategori(snap.weatherHourly ?? [])).toEqual(GABUNG);
    // Laporan final tidak disentuh lagi oleh pembaruan berikutnya.
    expect((await perbaruiCuacaTanggal("2026-09-01")).laporan).toBe(0);
  });
});
