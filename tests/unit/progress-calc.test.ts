import { describe, expect, it } from "vitest";
import { bobotPct, itemAchievement, prestasiPct, realizedPctFromItems } from "@/lib/progress-calc";

/** Formula prestasi/bobot — satu sumber utk laporan & dashboard. DECISIONS 151. */

describe("prestasiPct", () => {
  it("rasio volume terhadap volume kontrak", () => {
    expect(prestasiPct(25, 100)).toBe(25);
    expect(prestasiPct(100, 100)).toBe(100);
  });

  it("dibatasi 100% — pekerjaan tidak bisa 110% selesai", () => {
    expect(prestasiPct(110, 100)).toBe(100);
    expect(prestasiPct(1e9, 1)).toBe(100);
  });

  it("volume kontrak 0/negatif/tak wajar → 0, bukan bagi nol", () => {
    expect(prestasiPct(50, 0)).toBe(0);
    expect(prestasiPct(50, -10)).toBe(0);
    expect(prestasiPct(50, Number.NaN)).toBe(0);
  });

  it("volume negatif tidak menghasilkan prestasi negatif", () => {
    expect(prestasiPct(-5, 100)).toBe(0);
  });
});

describe("itemAchievement — kolom blanko KKP", () => {
  it("kasus normal: lalu + ini = s/d", () => {
    const a = itemAchievement({ volK: 100, volLalu: 30, volIni: 20, bobot: 10 });
    expect(a.prestasiLalu).toBe(30);
    expect(a.prestasiIni).toBe(20);
    expect(a.prestasiSd).toBe(50);
    expect(a.bobotLalu + a.bobotIni).toBeCloseTo(a.bobotSd, 12);
    expect(a.bobotSd).toBeCloseTo(5, 12);
  });

  it("REGRESI: volume melebihi kontrak — kolom TETAP berjumlah", () => {
    // Pembatas 100% per kolom (cara lama) menghasilkan lalu 50 + ini 60 = 110
    // padahal s/d 100 → baris di blanko KKP tidak jumlah.
    const a = itemAchievement({ volK: 100, volLalu: 50, volIni: 60, bobot: 10 });
    expect(a.prestasiSd).toBe(100);
    expect(a.prestasiLalu).toBe(50);
    expect(a.prestasiIni).toBe(50); // bukan 60 — dibatasi lewat pengurangan
    expect(a.prestasiLalu + a.prestasiIni).toBe(a.prestasiSd);
    expect(a.bobotLalu + a.bobotIni).toBeCloseTo(a.bobotSd, 12);
  });

  it("sudah 100% sebelum periode ini → tambahan periode ini 0%", () => {
    const a = itemAchievement({ volK: 100, volLalu: 100, volIni: 40, bobot: 8 });
    expect(a.prestasiLalu).toBe(100);
    expect(a.prestasiIni).toBe(0);
    expect(a.prestasiSd).toBe(100);
    expect(a.bobotIni).toBe(0);
  });

  it("belum ada realisasi sama sekali", () => {
    const a = itemAchievement({ volK: 100, volLalu: 0, volIni: 0, bobot: 12 });
    expect([a.prestasiLalu, a.prestasiIni, a.prestasiSd]).toEqual([0, 0, 0]);
    expect([a.bobotLalu, a.bobotIni, a.bobotSd]).toEqual([0, 0, 0]);
  });

  it("item tanpa volume kontrak tidak menyumbang prestasi apa pun", () => {
    const a = itemAchievement({ volK: 0, volLalu: 10, volIni: 5, bobot: 3 });
    expect(a.prestasiSd).toBe(0);
    expect(a.bobotSd).toBe(0);
  });

  it("kolom selalu berjumlah untuk banyak kombinasi acak-terkendali", () => {
    for (const volK of [1, 10, 100, 250.5]) {
      for (const volLalu of [0, 1, volK / 2, volK, volK * 1.5]) {
        for (const volIni of [0, 1, volK / 3, volK * 2]) {
          const a = itemAchievement({ volK, volLalu, volIni, bobot: 7.3 });
          expect(a.prestasiLalu + a.prestasiIni, `${volK}/${volLalu}/${volIni}`).toBeCloseTo(a.prestasiSd, 9);
          expect(a.bobotLalu + a.bobotIni, `${volK}/${volLalu}/${volIni}`).toBeCloseTo(a.bobotSd, 9);
          expect(a.prestasiSd).toBeLessThanOrEqual(100);
          expect(a.prestasiIni).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("realizedPctFromItems", () => {
  const items = [
    { volK: 100, volSd: 50, bobot: 40 }, // 50% × 40 = 20
    { volK: 200, volSd: 200, bobot: 35 }, // 100% × 35 = 35
    { volK: 50, volSd: 0, bobot: 25 }, // 0
  ];

  it("jumlah prestasi × bobot", () => {
    expect(realizedPctFromItems(items)).toBeCloseTo(55, 9);
  });

  it("tidak bisa melewati 100% walau ada item yang over", () => {
    const over = [
      { volK: 100, volSd: 500, bobot: 60 },
      { volK: 100, volSd: 300, bobot: 40 },
    ];
    expect(realizedPctFromItems(over)).toBeCloseTo(100, 9);
  });

  it("konsisten dengan itemAchievement pada data yang sama", () => {
    const viaAchievement = items.reduce(
      (s, it) => s + itemAchievement({ volK: it.volK, volLalu: 0, volIni: it.volSd, bobot: it.bobot }).bobotSd,
      0,
    );
    expect(realizedPctFromItems(items)).toBeCloseTo(viaAchievement, 9);
  });

  it("daftar kosong → 0", () => {
    expect(realizedPctFromItems([])).toBe(0);
  });
});

describe("bobotPct", () => {
  it("porsi nilai item terhadap total", () => {
    expect(bobotPct(25_000_000, 100_000_000)).toBe(25);
  });

  it("total 0 → 0 (RAB kosong tidak bikin NaN/Infinity di laporan)", () => {
    expect(bobotPct(1000, 0)).toBe(0);
    expect(bobotPct(1000, -5)).toBe(0);
  });

  it("Σ bobot seluruh item = 100", () => {
    const amounts = [15_000_000, 8_800_000, 54_000_000, 18_750_000];
    const total = amounts.reduce((a, b) => a + b, 0);
    expect(amounts.reduce((s, a) => s + bobotPct(a, total), 0)).toBeCloseTo(100, 9);
  });
});
