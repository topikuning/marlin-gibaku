import { describe, expect, it } from "vitest";
import { mingguTercapai, potongKurvaPaket } from "@/lib/progress-calc";

/** Kurva S per minggu prestasi termin & usulan minggu tercapai (DECISIONS 722). */

describe("potongKurvaPaket", () => {
  const kurva = { currentWeek: 6, planPct: [5, 12, 20, 30, 42, 55, 70, 85, 100], actualPct: [4, 10, 18, 26, 33, 41, null, null, null] };

  it("realisasi sesudah minggu prestasi dikosongkan; rencana utuh", () => {
    const k = potongKurvaPaket(kurva, 4);
    expect(k.currentWeek).toBe(4);
    expect(k.actualPct).toEqual([4, 10, 18, 26, null, null, null, null, null]);
    expect(k.planPct).toEqual(kurva.planPct);
    expect(kurva.actualPct[4]).toBe(33); // aslinya tidak diubah
  });

  it("minggu di depan minggu berjalan tidak mengarang realisasi; minimal minggu 1", () => {
    expect(potongKurvaPaket(kurva, 20)).toMatchObject({ currentWeek: 6, actualPct: kurva.actualPct });
    expect(potongKurvaPaket(kurva, 0).currentWeek).toBe(1);
  });
});

describe("mingguTercapai", () => {
  it("minggu PERTAMA realisasi kumulatif ≥ ambang", () => {
    expect(mingguTercapai([4, 10, 18, 26, 33], 25)).toBe(4);
    expect(mingguTercapai([4, 10, 18, 26, 33], 18)).toBe(3);
    expect(mingguTercapai([4, 10, 18, 26, 33], 50)).toBeNull();
  });

  it("minggu tanpa laporan dilewati; sisa pembulatan penjumlahan berbobot tidak menggeser minggunya", () => {
    expect(mingguTercapai([null, 12, null, 25 - 1e-12], 25)).toBe(4);
    expect(mingguTercapai([], 25)).toBeNull();
  });
});
