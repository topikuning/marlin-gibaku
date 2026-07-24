import { describe, expect, it } from "vitest";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { curveFromCategorySchedule } from "@/lib/scurve/generate";

describe("buildKurvaSheet (dari jadwal per-kategori tersimpan — DECISIONS 079)", () => {
  // Jadwal per kategori: bobot + jendela minggu (seperti BaselineScheduleItem).
  const categories = [
    { code: "I", name: "PEKERJAAN PERSIAPAN", weightPct: 10, startWeek: 1, endWeek: 6 },
    { code: "II", name: "PEKERJAAN PONDASI", weightPct: 40, startWeek: 5, endWeek: 12 },
    { code: "III", name: "PEKERJAAN BANGUNAN", weightPct: 30, startWeek: 10, endWeek: 16 },
    { code: "IV", name: "PEKERJAAN PENERANGAN KAWASAN", weightPct: 20, startWeek: 17, endWeek: 22 },
  ];
  const contractStart = new Date(Date.UTC(2026, 2, 1)); // 1 Mar 2026
  const sheet = buildKurvaSheet({
    categories,
    totalWeeks: 22,
    contractStart,
    actualCum: Array(22).fill(null),
    currentWeek: 1,
  });

  it("kumulatif rencana monotonik & berakhir ~100", () => {
    for (let i = 1; i < sheet.kumulatifRencana.length; i++) {
      expect(sheet.kumulatifRencana[i]).toBeGreaterThanOrEqual(sheet.kumulatifRencana[i - 1] - 1e-9);
    }
    expect(sheet.kumulatifRencana.at(-1)).toBeCloseTo(100, 1);
  });

  it("increment mingguan tiap kategori menjumlah ke bobotnya", () => {
    sheet.categories.forEach((c, idx) => {
      const sum = c.weekly.reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(categories[idx].weightPct, 1);
    });
  });

  it("PENERANGAN KAWASAN nol sampai minggu 16, baru terisi 17–22 (presedensi)", () => {
    const pen = sheet.categories[3];
    for (let w = 0; w < 16; w++) expect(pen.weekly[w]).toBe(0);
    for (let w = 16; w < 22; w++) expect(pen.weekly[w]).toBeGreaterThan(0);
  });

  it("kumulatif KKP IDENTIK dgn kurva baseline (curveFromCategorySchedule) — sinkron grafik", () => {
    const curve = curveFromCategorySchedule(
      categories.map((c) => ({ weightPct: c.weightPct, startWeek: c.startWeek, endWeek: c.endWeek })),
      22,
    );
    sheet.kumulatifRencana.forEach((v, i) => expect(v).toBeCloseTo(curve[i], 6));
  });

  it("kolom dikelompokkan per bulan, total span = totalWeeks", () => {
    const span = sheet.monthGroups.reduce((s, g) => s + g.span, 0);
    expect(span).toBe(22);
    expect(sheet.monthGroups[0].label).toBe("MARET");
  });

  it("mulai landai: kumulatif minggu-1 < porsi linear", () => {
    expect(sheet.kumulatifRencana[0]).toBeLessThan(100 / 22);
    expect(sheet.kumulatifRencana[0]).toBeGreaterThan(0);
  });

  it("realisasi null → deviasi null (belum ada data)", () => {
    expect(sheet.deviasi.every((d) => d === null)).toBe(true);
  });
});
