import { describe, expect, it } from "vitest";
import {
  buildHourlyWeather,
  categoryFromWmo,
  countRainHours,
  dominantWeatherCode,
  hourlyCategoryEntries,
  KKP_WEATHER_HOURS,
  parseHourlyWeather,
  totalRainMm,
  type HourlyWeather,
} from "@/lib/weather/hourly";

const H = (hour: number, category: HourlyWeather["category"], precipMm = 0, code = 0): HourlyWeather => ({
  hour,
  category,
  precipMm,
  code,
});

describe("categoryFromWmo – kode WMO → tiga kategori blanko KKP", () => {
  it("cerah / mendung / hujan sesuai rentang kode", () => {
    expect(categoryFromWmo(0, 0)).toBe("Cerah");
    expect(categoryFromWmo(1, 0)).toBe("Cerah");
    expect(categoryFromWmo(2, 0)).toBe("Mendung");
    expect(categoryFromWmo(3, 0)).toBe("Mendung");
    expect(categoryFromWmo(45, 0)).toBe("Mendung"); // kabut
    expect(categoryFromWmo(51, 0)).toBe("Hujan"); // gerimis
    expect(categoryFromWmo(95, 0)).toBe("Hujan"); // badai petir
  });

  it("curah hujan terukur MENANG atas kode cerah", () => {
    // Kode bilang cerah tapi tercatat hujan 1,2 mm → tulis Hujan.
    expect(categoryFromWmo(0, 1.2)).toBe("Hujan");
    // Di bawah ambang (rintik tak berarti) tetap mengikuti kode.
    expect(categoryFromWmo(0, 0.1)).toBe("Cerah");
  });
});

describe("buildHourlyWeather – ambil hanya tanggal & jam blanko", () => {
  const time: string[] = [];
  const weatherCode: number[] = [];
  const precipitation: number[] = [];
  // 2 hari × 24 jam; hari kedua adalah tanggal yang diminta.
  for (const day of ["2026-07-28", "2026-07-29"]) {
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, "0")}:00`);
      weatherCode.push(day === "2026-07-29" && h >= 13 && h <= 15 ? 61 : 1);
      precipitation.push(day === "2026-07-29" && h >= 13 && h <= 15 ? 2.5 : 0);
    }
  }

  it("hanya jam 07–21 pada tanggal yang diminta", () => {
    const hours = buildHourlyWeather({ time, weatherCode, precipitation }, "2026-07-29");
    expect(hours.map((h) => h.hour)).toEqual([...KKP_WEATHER_HOURS]);
    expect(hours.filter((h) => h.category === "Hujan").map((h) => h.hour)).toEqual([13, 14, 15]);
  });

  it("jam yang belum ada datanya dilewati, bukan ditebak", () => {
    // Hari berjalan: data baru sampai jam 14.
    const partialIdx = time.findIndex((t) => t === "2026-07-29T15:00");
    const hours = buildHourlyWeather(
      {
        time: time.slice(0, partialIdx),
        weatherCode: weatherCode.slice(0, partialIdx),
        precipitation: precipitation.slice(0, partialIdx),
      },
      "2026-07-29",
    );
    expect(hours.map((h) => h.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("tanggal lain tidak ikut terbawa", () => {
    const hours = buildHourlyWeather({ time, weatherCode, precipitation }, "2026-07-28");
    expect(hours.every((h) => h.category !== "Hujan")).toBe(true);
  });
});

describe("dominantWeatherCode – ringkasan satu nilai untuk kolom lama", () => {
  it("hujan deras bila ada jam ≥4 mm atau kode hujan lebat", () => {
    expect(dominantWeatherCode([H(7, "Cerah"), H(13, "Hujan", 6)])).toBe("hujan_deras");
    expect(dominantWeatherCode([H(13, "Hujan", 1, 95)])).toBe("hujan_deras");
  });

  it("hujan ringan bila ada jam hujan tapi tidak deras", () => {
    expect(dominantWeatherCode([H(7, "Cerah"), H(13, "Hujan", 1)])).toBe("hujan_ringan");
  });

  it("berawan bila mendung mendominasi; cerah bila tidak", () => {
    expect(dominantWeatherCode([H(7, "Mendung"), H(8, "Mendung"), H(9, "Cerah")])).toBe("berawan");
    expect(dominantWeatherCode([H(7, "Cerah"), H(8, "Cerah"), H(9, "Mendung")])).toBe("cerah");
  });

  it("TIDAK PERNAH menghasilkan angin kencang / banjir (itu pengamatan lapangan)", () => {
    const hours = [H(7, "Hujan", 20, 99), H(8, "Hujan", 30, 99)];
    expect(dominantWeatherCode(hours)).toBe("hujan_deras");
  });

  it("tanpa data → null (jangan mengarang)", () => {
    expect(dominantWeatherCode([])).toBeNull();
  });
});

describe("turunan jam hujan", () => {
  it("countRainHours & totalRainMm dihitung dari deret, bukan disimpan", () => {
    const hours = [H(7, "Cerah"), H(13, "Hujan", 2.5), H(14, "Hujan", 1.25)];
    expect(countRainHours(hours)).toBe(2);
    expect(totalRainMm(hours)).toBe(3.8); // 3.75 → 1 desimal
  });
});

describe("parseHourlyWeather – baca Json DB dengan aman", () => {
  it("bentuk benar → terbaca & terurut", () => {
    const parsed = parseHourlyWeather([
      { hour: 9, category: "Hujan", precipMm: 1, code: 61 },
      { hour: 7, category: "Cerah", precipMm: 0, code: 0 },
    ]);
    expect(parsed?.map((h) => h.hour)).toEqual([7, 9]);
  });

  it("bentuk tak dikenal → null (jalur cetak jatuh ke perilaku lama, tidak melempar)", () => {
    expect(parseHourlyWeather(null)).toBeNull();
    expect(parseHourlyWeather("hujan")).toBeNull();
    expect(parseHourlyWeather([{ hour: 3, category: "Cerah" }])).toBeNull(); // jam di luar blanko
    expect(parseHourlyWeather([{ hour: 7, category: "Gerimis" }])).toBeNull(); // kategori asing
    expect(parseHourlyWeather([])).toBeNull();
  });
});

describe("hourlyCategoryEntries – peta untuk centang blanko", () => {
  it("objek biasa (aman menyeberang ke komponen), jam tanpa data absen", () => {
    const map = hourlyCategoryEntries([H(7, "Cerah"), H(13, "Hujan", 2)]);
    expect(map).toEqual({ 7: "Cerah", 13: "Hujan" });
    expect(map[8]).toBeUndefined();
  });
});
