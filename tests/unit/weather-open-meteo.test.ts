import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchHourlyWeather, WeatherFetchError } = await import("@/lib/weather/open-meteo");

/**
 * Yang diuji: permintaan MENGIKUTI TANGGAL LAPORAN, bukan hari ini — laporan
 * yang diisi mundur (mis. lupa 3 hari) harus tetap mendapat kondisi tanggal
 * tersebut, bukan cuaca hari pengisian (DECISIONS 176/177).
 */

type Captured = { url: URL };
const captured: Captured[] = [];

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    captured.push({ url: new URL(String(input)) });
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as Response;
  });
}

/** Respons penyedia: 24 jam untuk dua tanggal; hujan jam 13–15 pada 26 Juli. */
function bodyFor(days: string[]) {
  const time: string[] = [];
  const weather_code: number[] = [];
  const precipitation: number[] = [];
  for (const day of days) {
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, "0")}:00`);
      const hujan = day === "2026-07-26" && h >= 13 && h <= 15;
      weather_code.push(hujan ? 61 : 0);
      precipitation.push(hujan ? 2 : 0);
    }
  }
  return { hourly: { time, weather_code, precipitation } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  captured.length = 0;
});

describe("fetchHourlyWeather — tanggal laporan, bukan hari ini", () => {
  it("laporan 3 hari lalu → minta cukup hari mundur & kembalikan jam tanggal ITU", async () => {
    stubFetch(bodyFor(["2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29"]));

    const hours = await fetchHourlyWeather({
      lat: -8.4,
      lng: 114.3,
      dateKey: "2026-07-26",
      todayKey: "2026-07-29",
    });

    const url = captured[0].url;
    expect(url.searchParams.get("timezone")).toBe("Asia/Jakarta");
    expect(Number(url.searchParams.get("past_days"))).toBeGreaterThanOrEqual(4); // 3 hari + hari ini
    expect(url.searchParams.get("hourly")).toBe("weather_code,precipitation");

    // Hanya jam blanko (07–21) tanggal 26 — bukan tanggal lain.
    expect(hours).toHaveLength(15);
    expect(hours.filter((h) => h.category === "Hujan").map((h) => h.hour)).toEqual([13, 14, 15]);
  });

  it("laporan hari ini → tetap jam tanggal hari ini", async () => {
    stubFetch(bodyFor(["2026-07-28", "2026-07-29"]));
    const hours = await fetchHourlyWeather({
      lat: -8.4,
      lng: 114.3,
      dateKey: "2026-07-29",
      todayKey: "2026-07-29",
    });
    expect(hours).toHaveLength(15);
    expect(hours.every((h) => h.category === "Cerah")).toBe(true);
  });

  it("tanggal di masa depan ditolak — tidak menembak penyedia sama sekali", async () => {
    stubFetch(bodyFor(["2026-07-30"]));
    await expect(
      fetchHourlyWeather({ lat: -8.4, lng: 114.3, dateKey: "2026-07-30", todayKey: "2026-07-29" }),
    ).rejects.toThrow(WeatherFetchError);
    expect(captured).toHaveLength(0);
  });

  it("lebih dari 60 hari lalu ditolak dengan pesan jelas", async () => {
    stubFetch(bodyFor(["2026-01-01"]));
    await expect(
      fetchHourlyWeather({ lat: -8.4, lng: 114.3, dateKey: "2026-01-01", todayKey: "2026-07-29" }),
    ).rejects.toThrow(/60 hari/);
    expect(captured).toHaveLength(0);
  });

  it("penyedia menolak (HTTP 500) → error yang bisa dibaca orang lapangan", async () => {
    stubFetch({}, false);
    await expect(
      fetchHourlyWeather({ lat: -8.4, lng: 114.3, dateKey: "2026-07-28", todayKey: "2026-07-29" }),
    ).rejects.toThrow(/layanan cuaca/i);
  });

  it("tanggal yang diminta tidak ada di balasan → error, BUKAN data kosong diam-diam", async () => {
    stubFetch(bodyFor(["2026-07-29"]));
    await expect(
      fetchHourlyWeather({ lat: -8.4, lng: 114.3, dateKey: "2026-07-27", todayKey: "2026-07-29" }),
    ).rejects.toThrow(/tidak punya data jam/i);
  });
});
