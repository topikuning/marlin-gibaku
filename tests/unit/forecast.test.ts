import { describe, expect, it } from "vitest";
import { forecastFromSeries } from "@/lib/forecast";

const START = new Date("2026-01-05T00:00:00.000Z"); // Senin, minggu-1 mulai

/** Bangun deret aktual kumulatif linear sampai `weeks` minggu pada `perWeek` %/minggu. */
function actualLinear(perWeek: number, weeks: number, total: number): (number | null)[] {
  const arr: (number | null)[] = new Array(total).fill(null);
  for (let i = 0; i < weeks; i++) arr[i] = Math.min(100, (i + 1) * perWeek);
  return arr;
}
function planLinear(total: number): number[] {
  return Array.from({ length: total }, (_, i) => Math.min(100, ((i + 1) / total) * 100));
}

describe("forecastFromSeries", () => {
  const N = 20;

  it("tepat sesuai rencana → status aman, selesai ≈ akhir kontrak", () => {
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actualLinear(5, 10, N) },
      START,
    );
    expect(f.enoughData).toBe(true);
    expect(f.status).toBe("aman");
    expect(f.forecastFinishWeek).toBeGreaterThanOrEqual(19);
    expect(f.forecastFinishWeek).toBeLessThanOrEqual(21);
    expect(f.forecastFinishDate).toBeInstanceOf(Date);
    expect(f.slipWeeks ?? 0).toBeLessThanOrEqual(1);
  });

  it("realisasi lambat → prognosa telat + slip positif", () => {
    // rencana 5%/mgg, aktual hanya 3%/mgg → butuh ~33 minggu utk 100%.
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actualLinear(3, 10, N) },
      START,
    );
    expect(f.status).toBe("telat");
    expect(f.slipWeeks!).toBeGreaterThan(0);
    expect(f.forecastFinishWeek!).toBeGreaterThan(N);
    expect(f.deviationPct).toBeLessThan(0);
    expect(f.velocityPerWeek!).toBeCloseTo(3, 1);
    expect(f.projectedPctAtEnd!).toBeLessThan(100);
    expect(f.requiredPerWeek!).toBeGreaterThan(f.velocityPerWeek!);
  });

  it("laju terkini terhenti → jatuh ke SPI (bukan telat otomatis)", () => {
    // maju 4 minggu pertama lalu stagnan 6 minggu → laju window≈0, SPI masih >0.
    const actual: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < 4; i++) actual[i] = (i + 1) * 6; // 6,12,18,24
    for (let i = 4; i < 10; i++) actual[i] = 24; // stagnan
    const f = forecastFromSeries({ totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actual }, START);
    expect(f.method).toBe("spi");
    expect(f.forecastFinishWeek).not.toBeNull();
  });

  it("data < 2 titik → data_kurang", () => {
    const actual: (number | null)[] = new Array(N).fill(null);
    actual[0] = 4;
    const f = forecastFromSeries({ totalWeeks: N, currentWeek: 3, planPct: planLinear(N), actualPct: actual }, START);
    expect(f.status).toBe("data_kurang");
    expect(f.enoughData).toBe(false);
  });

  it("belum ada realisasi → belum_mulai", () => {
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 2, planPct: planLinear(N), actualPct: new Array(N).fill(null) },
      START,
    );
    expect(f.status).toBe("belum_mulai");
  });

  it("sudah 100% → selesai", () => {
    const actual = actualLinear(20, 6, N); // 20,40,60,80,100,100
    const f = forecastFromSeries({ totalWeeks: N, currentWeek: 6, planPct: planLinear(N), actualPct: actual }, START);
    expect(f.status).toBe("selesai");
    expect(f.projectedPctAtEnd).toBe(100);
  });

  it("garis prognosa: null sebelum titik aktual, kembali menuju 100", () => {
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 8, planPct: planLinear(N), actualPct: actualLinear(4, 8, N) },
      START,
    );
    expect(f.forecastPct.length).toBe(N);
    expect(f.forecastPct[0]).toBeNull(); // minggu 1 < titik aktual
    expect(f.forecastPct[7]).toBeCloseTo(32, 0); // anchor di minggu 8 = 4×8
    const finishIdx = Math.min(N, Math.ceil(f.forecastFinishWeek!)) - 1;
    if (finishIdx < N) expect(f.forecastPct[finishIdx]!).toBeGreaterThanOrEqual(f.forecastPct[7]!);
  });

  it("laju ≈ 0 → tanggal/selisih diredam (beyondHorizon), status tetap telat", () => {
    // 0.05%/mgg → butuh ±2000 minggu; dulu tampil "16 Apr 2086, telat ~3115 mgg".
    const actual: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < 10; i++) actual[i] = (i + 1) * 0.05;
    const f = forecastFromSeries({ totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actual }, START);
    expect(f.status).toBe("telat");
    expect(f.beyondHorizon).toBe(true);
    expect(f.forecastFinishWeek).toBeNull();
    expect(f.forecastFinishDate).toBeNull();
    expect(f.slipWeeks).toBeNull();
    expect(f.projectedPctAtEnd!).toBeLessThan(5); // proyeksi % akhir kontrak tetap ada
  });

  it("telat moderat (< horizon) → tanggal & slip TETAP tampil", () => {
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actualLinear(3, 10, N) },
      START,
    );
    expect(f.beyondHorizon).toBe(false);
    expect(f.forecastFinishDate).toBeInstanceOf(Date);
    expect(f.slipWeeks).not.toBeNull();
  });

  it("tanpa startDate → tanggal null tapi minggu tetap", () => {
    const f = forecastFromSeries(
      { totalWeeks: N, currentWeek: 10, planPct: planLinear(N), actualPct: actualLinear(5, 10, N) },
      null,
    );
    expect(f.forecastFinishWeek).not.toBeNull();
    expect(f.forecastFinishDate).toBeNull();
  });
});
