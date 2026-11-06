import { describe, expect, it } from "vitest";
import { batasLapor, keDraftAdendum } from "@/lib/daily-report/batas-lapor";

/**
 * BATAS VOLUME LAPORAN HARIAN bila draft adendum menaikkan volume item kontrak
 * (DECISIONS 742). Keluhan user 2026-11-05: volume kontrak 317,97 sudah habis,
 * draft adendum 3.045,152 belum diaktifkan – input 200 m³ ditolak "sisa 0".
 */
describe("batasLapor", () => {
  it("tanpa draft yang lebih besar: batasnya sisa kontrak", () => {
    expect(batasLapor({ remaining: 5 })).toBe(5);
    expect(batasLapor({ remaining: 5, sisaDraft: null })).toBe(5);
  });

  it("kontrak habis, draft lebih besar: batasnya sisa menurut draft", () => {
    expect(batasLapor({ remaining: 0, sisaDraft: 2727.182 })).toBe(2727.182);
  });

  it("item tanpa volume: tidak dibatasi", () => {
    expect(batasLapor({ remaining: null, sisaDraft: 10 })).toBeNull();
  });
});

describe("keDraftAdendum", () => {
  const o = { remaining: 5, sisaDraft: 55 };
  it("di dalam sisa kontrak: tetap resmi", () => {
    expect(keDraftAdendum(o, 5)).toBe(false);
    expect(keDraftAdendum(o, 5.0000001)).toBe(false);
  });
  it("di atas sisa kontrak, di dalam sisa draft: dicatat ke draft adendum", () => {
    expect(keDraftAdendum(o, 5.001)).toBe(true);
    expect(keDraftAdendum(o, 55)).toBe(true);
  });
  it("di atas sisa draft: tidak bisa (ditolak), bukan ke draft", () => {
    expect(keDraftAdendum(o, 55.001)).toBe(false);
  });
  it("tanpa draft yang lebih besar: tidak pernah ke draft", () => {
    expect(keDraftAdendum({ remaining: 5 }, 6)).toBe(false);
  });
});
