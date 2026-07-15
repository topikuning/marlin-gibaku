import { describe, expect, it } from "vitest";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";

describe("buildKurvaSheet", () => {
  const categories = [
    { code: "I", name: "PEKERJAAN PERSIAPAN", items: [{ name: "Pembersihan lahan", bobot: 10 }] },
    { code: "II", name: "PEKERJAAN PONDASI", items: [{ name: "Pondasi batu kali", bobot: 40 }] },
    { code: "III", name: "PEKERJAAN BANGUNAN BALAI NELAYAN", items: [{ name: "Beton kolom", bobot: 30 }] },
    { code: "IV", name: "PEKERJAAN LANDSKAPING", items: [{ name: "Penanaman pohon", bobot: 20 }] },
  ];
  const bobotOf = (i: number) => categories[i].items.reduce((s, it) => s + it.bobot, 0);
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
      expect(sum).toBeCloseTo(bobotOf(idx), 1);
    });
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
