import { describe, expect, it } from "vitest";
// Inti murni (tanpa DB / server-only) — bisa diimpor langsung.
import { computeSuggestions } from "@/lib/plan/suggest-core";

/**
 * Skenario: 22 minggu. Item "Galian" (trade=tanah, jendela 0.05–0.28 → minggu
 * ~1–6) volume 100, minggu ke-5.
 *   - fraksi rencana s/d minggu 5 vs minggu 4 → target normal minggu ini.
 *   - bila realisasi 0 padahal seharusnya sudah banyak → target mengejar.
 */
const leaf = (over: Partial<Parameters<typeof computeSuggestions>[0][number]> = {}) => ({
  rabNodeId: "n1",
  code: "1",
  name: "Galian tanah pondasi",
  unit: "m3",
  categoryName: "PEKERJAAN TANAH",
  volume: 100,
  unitPrice: 1000,
  lineageKey: "I#1",
  ...over,
});

describe("computeSuggestions", () => {
  it("tertinggal (realisasi 0) → target mengejar (catchUp > 0) & alasan 'Tertinggal'", () => {
    const res = computeSuggestions([leaf()], new Map(), 5, 22);
    expect(res).toHaveLength(1);
    expect(res[0].catchUpVolume).toBeGreaterThan(0);
    expect(res[0].targetVolume).toBeGreaterThan(res[0].catchUpVolume - 1e-6);
    expect(res[0].reason).toMatch(/Tertinggal/i);
    expect(res[0].valueTarget).toBe(Math.round(res[0].targetVolume * 1000));
  });

  it("sesuai jadwal (realisasi = rencana s/d minggu lalu) → tanpa catchUp", () => {
    // Hitung rencana s/d minggu 4 utk trade tanah, isi sebagai realisasi.
    const onSched = computeSuggestions([leaf()], new Map(), 5, 22);
    const plannedByW4 = onSched[0].targetVolume - onSched[0].catchUpVolume; // increment mgg ini
    void plannedByW4;
    // realisasi = seluruh yang seharusnya selesai s/d minggu 4:
    const map = new Map([["I#1", 100 * fracTanahByWeek4()]]);
    const res = computeSuggestions([leaf()], map, 5, 22);
    expect(res).toHaveLength(1);
    expect(res[0].catchUpVolume).toBeLessThan(1e-3);
    expect(res[0].reason).toMatch(/jadwal|Mulai/i);
  });

  it("item sudah selesai (realisasi ≥ volume) → tidak disarankan", () => {
    const res = computeSuggestions([leaf()], new Map([["I#1", 100]]), 5, 22);
    expect(res).toHaveLength(0);
  });

  it("item di luar jendela (belum mulai) → tidak disarankan", () => {
    // trade landscape (0.85–1.0) di minggu 3 dari 22 → belum aktif, tak tertinggal.
    const res = computeSuggestions(
      [leaf({ name: "Penanaman pohon", categoryName: "LANDSCAPE" })],
      new Map(),
      3,
      22,
    );
    expect(res).toHaveLength(0);
  });

  it("target di-clamp ke sisa volume", () => {
    // realisasi 95 dari 100 → sisa 5, target tak boleh > 5.
    const res = computeSuggestions([leaf()], new Map([["I#1", 95]]), 6, 22);
    if (res.length) {
      expect(res[0].targetVolume).toBeLessThanOrEqual(5 + 1e-6);
      expect(res[0].remainingVolume).toBeCloseTo(5, 3);
    }
  });

  it("prioritas 1 = dampak rupiah terbesar", () => {
    const big = leaf({ rabNodeId: "big", lineageKey: "I#2", volume: 1000, unitPrice: 5000, name: "Beton besar", categoryName: "STRUKTUR" });
    const small = leaf({ rabNodeId: "small", lineageKey: "I#3", volume: 10, unitPrice: 100 });
    const res = computeSuggestions([small, big], new Map(), 8, 22);
    expect(res[0].priority).toBeLessThanOrEqual(res[res.length - 1].priority);
    expect(res[0].valueTarget).toBeGreaterThanOrEqual(res[res.length - 1].valueTarget);
  });
});

// Fraksi smoothstep trade "tanah" (0.05–0.28) pada akhir minggu 4 dari 22.
function fracTanahByWeek4(): number {
  const t = 4 / 22;
  const s = 0.05,
    e = 0.28;
  const x = Math.max(0, Math.min(1, (t - s) / (e - s)));
  return 3 * x * x - 2 * x * x * x;
}
