import { describe, expect, it } from "vitest";
import { pecahRencanaMingguan, rencanaHarian, type RencanaMingguanItem } from "@/lib/plan/rencana-harian";

/**
 * Rencana mingguan → harian: kolom "Rencana Pekerjaan" blanko harian.
 * Yang dijaga: kolom harian menjumlah tepat ke target mingguan, urutan hari
 * mengikuti metode kerja (galian sebelum struktur, finishing paling belakang),
 * dan hari tanpa rencana tetap kosong.
 */

const item = (
  name: string,
  categoryName: string,
  targetVolume: number,
  over: Partial<RencanaMingguanItem> = {},
): RencanaMingguanItem => ({
  name,
  categoryName,
  unit: "m3",
  targetVolume,
  amount: 100_000_000n,
  picName: null,
  priority: 5,
  ...over,
});

const DAYS = 7;

describe("pecahRencanaMingguan", () => {
  const items = [
    item("Galian tanah pondasi", "PEKERJAAN STRUKTUR", 120),
    item("Pembesian kolom", "PEKERJAAN STRUKTUR", 2_400),
    item("Pengecatan dinding", "PEKERJAAN ARSITEKTUR", 300),
  ];

  it("Σ rencana harian tiap item PERSIS target mingguannya", () => {
    const m = pecahRencanaMingguan(items, DAYS);
    m.forEach((perDay, i) => {
      expect(perDay).toHaveLength(DAYS);
      expect(perDay.reduce((s, v) => s + v, 0), items[i].name).toBeCloseTo(items[i].targetVolume, 6);
    });
  });

  it("tidak ada volume negatif; hari di luar jendela item tetap 0", () => {
    const m = pecahRencanaMingguan(items, DAYS);
    for (const perDay of m) {
      for (const v of perDay) expect(v).toBeGreaterThanOrEqual(0);
      expect(perDay.some((v) => v === 0), "ada hari kosong di jendela sempit").toBe(true);
    }
  });

  it("urutan metode kerja: galian mulai lebih awal daripada pengecatan", () => {
    const m = pecahRencanaMingguan(items, DAYS);
    const mulai = (row: number[]) => row.findIndex((v) => v > 0);
    expect(mulai(m[0]), "galian").toBeLessThan(mulai(m[2]));
  });

  it("target 0 / daftar kosong tidak meledak", () => {
    expect(pecahRencanaMingguan([], DAYS)).toEqual([]);
    const nol = pecahRencanaMingguan([item("Item tanpa target", "PEKERJAAN PERSIAPAN", 0)], DAYS);
    expect(nol[0].reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe("rencanaHarian (baris untuk satu hari)", () => {
  const items = [
    item("Galian tanah pondasi", "PEKERJAAN STRUKTUR", 120, { picName: "Mandor A", priority: 1 }),
    item("Pengecatan dinding", "PEKERJAAN ARSITEKTUR", 300, { picName: "Mandor B" }),
  ];

  it("hanya menampilkan item yang punya rencana pada hari itu", () => {
    const hari1 = rencanaHarian(items, DAYS, 1);
    for (const r of hari1) expect(r.volume).toBeGreaterThan(0);
    // Pengecatan (tahap akhir) belum jalan di hari-1.
    expect(hari1.map((r) => r.name)).not.toContain("Pengecatan dinding");
  });

  it("kumulatif s/d hari ini naik monoton dan berakhir di target minggu", () => {
    let prev = 0;
    for (let d = 1; d <= DAYS; d++) {
      const row = rencanaHarian(items, DAYS, d).find((r) => r.name === "Galian tanah pondasi");
      if (!row) continue;
      expect(row.volumeSdHariIni).toBeGreaterThanOrEqual(prev);
      prev = row.volumeSdHariIni;
      expect(row.targetMinggu).toBe(120);
    }
    expect(prev).toBeCloseTo(120, 6);
  });

  it("membawa PIC dan satuan apa adanya", () => {
    for (let d = 1; d <= DAYS; d++) {
      const row = rencanaHarian(items, DAYS, d).find((r) => r.name === "Galian tanah pondasi");
      if (row) {
        expect(row.picName).toBe("Mandor A");
        expect(row.unit).toBe("m3");
        break;
      }
    }
  });

  it("hari di luar rentang dijepit ke dalam minggu", () => {
    expect(rencanaHarian(items, DAYS, 0)).toEqual(rencanaHarian(items, DAYS, 1));
    expect(rencanaHarian(items, DAYS, 99)).toEqual(rencanaHarian(items, DAYS, DAYS));
  });
});
