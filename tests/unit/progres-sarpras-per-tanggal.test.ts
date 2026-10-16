/*
 * PROGRES SATU SARANA/PRASARANA PER TANGGAL – untuk dokumentasi foto
 * (DECISIONS 683). Permintaan user 2026-10-16: tiap foto di slide menyebut
 * progres sarananya sampai tanggal foto itu.
 *
 * Rumusnya WAJIB sama dengan baris kategori halaman "Progres per Kategori"
 * laporan mingguan (`ringkasKelompok`): Σ bobot terealisasi ÷ Σ bobot, dengan
 * prestasi item = min(100, volume s/d ÷ volume kontrak × 100).
 */
import { describe, expect, it } from "vitest";
import { progresKelompokPerTanggal } from "@/lib/progress-calc";

// Sarana: dua item. A Rp 6 jt (vol 10), B Rp 4 jt (vol 4). Grand total RAB 20 jt.
const items = [
  { lineageKey: "I#1", amount: 6_000_000, volume: 10 },
  { lineageKey: "I#2", amount: 4_000_000, volume: 4 },
];
const GT = 20_000_000;

describe("progresKelompokPerTanggal", () => {
  it("kumulatif s/d tiap tanggal, tertimbang nilai item", () => {
    const realisasi = [
      { lineageKey: "I#1", tanggal: "2026-07-01", volume: 5 }, // A 50%
      { lineageKey: "I#2", tanggal: "2026-07-03", volume: 1 }, // B 25%
      { lineageKey: "I#1", tanggal: "2026-07-05", volume: 5 }, // A 100%
    ];
    const p = progresKelompokPerTanggal(items, realisasi, GT, ["2026-06-30", "2026-07-01", "2026-07-04", "2026-07-05"]);
    expect(p.get("2026-06-30")).toBe(0);
    // 0,5 × 6 jt ÷ 10 jt = 30%
    expect(p.get("2026-07-01")).toBeCloseTo(30, 9);
    // (0,5 × 6 + 0,25 × 4) ÷ 10 = 40%
    expect(p.get("2026-07-04")).toBeCloseTo(40, 9);
    // (1 × 6 + 0,25 × 4) ÷ 10 = 70%
    expect(p.get("2026-07-05")).toBeCloseTo(70, 9);
  });

  it("prestasi item dibatasi 100% – volume lebih tidak menaikkan sarana", () => {
    const p = progresKelompokPerTanggal(
      items,
      [
        { lineageKey: "I#1", tanggal: "2026-07-01", volume: 25 },
        { lineageKey: "I#2", tanggal: "2026-07-01", volume: 4 },
      ],
      GT,
      ["2026-07-01"],
    );
    expect(p.get("2026-07-01")).toBe(100);
  });

  it("realisasi item di luar sarana ini tidak ikut", () => {
    const p = progresKelompokPerTanggal(items, [{ lineageKey: "II#1", tanggal: "2026-07-01", volume: 99 }], GT, [
      "2026-07-01",
    ]);
    expect(p.get("2026-07-01")).toBe(0);
  });

  it("sarana tanpa nilai (semua item Rp 0) = 0, bukan NaN", () => {
    const p = progresKelompokPerTanggal([{ lineageKey: "I#1", amount: 0, volume: 1 }], [], GT, ["2026-07-01"]);
    expect(p.get("2026-07-01")).toBe(0);
  });
});
