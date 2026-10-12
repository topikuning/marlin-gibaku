/*
 * Ringkasan kelompok untuk halaman "LAPORAN PROGRES MINGGUAN" per kategori &
 * sub-kategori (format Lampiran Termin, DECISIONS 670).
 */
import { describe, expect, it } from "vitest";
import { ringkasKelompok } from "@/lib/progress-calc";
import { keteranganDeviasi } from "@/lib/plan/rencana-format";

const baris = (o: Partial<Parameters<typeof ringkasKelompok>[0][number]>) => ({
  amount: 0,
  bobot: 0,
  bobotLalu: 0,
  bobotIni: 0,
  bobotSd: 0,
  bobotRencana: 0,
  ...o,
});

describe("ringkasKelompok", () => {
  it("menjumlah bobot item; progres = bobot terealisasi ÷ bobot kelompok", () => {
    const r = ringkasKelompok([
      baris({ amount: 300, bobot: 6, bobotLalu: 3, bobotIni: 1, bobotSd: 4, bobotRencana: 5 }),
      baris({ amount: 200, bobot: 4, bobotLalu: 0, bobotIni: 1, bobotSd: 1, bobotRencana: 2 }),
    ]);
    expect(r).toMatchObject({ nilai: 500, bobot: 10, bobotLalu: 3, bobotIni: 2, bobotSd: 5, bobotRencana: 7 });
    expect(r.progresLalu).toBeCloseTo(30, 10);
    expect(r.progresIni).toBeCloseTo(20, 10);
    expect(r.progresSd).toBeCloseTo(50, 10);
  });

  it("sisa = yang MASIH harus dikerjakan, positif (contoh berkas termin menulisnya minus)", () => {
    const r = ringkasKelompok([baris({ bobot: 10.181, bobotSd: 5.24 })]);
    expect(r.sisaProgres).toBeCloseTo(100 - (5.24 / 10.181) * 100, 10);
    expect(r.sisaBobot).toBeCloseTo(10.181 - 5.24, 10);
    expect(r.sisaProgres).toBeGreaterThan(0);
  });

  it("kelompok kosong / tanpa bobot: semua nol, tidak NaN", () => {
    const r = ringkasKelompok([]);
    expect(Object.values(r).every((v) => v === 0 || v === 100)).toBe(true);
    expect(r.sisaProgres).toBe(100);
    expect(Number.isNaN(ringkasKelompok([baris({ bobotSd: 1 })]).progresSd)).toBe(false);
  });
});

describe("keteranganDeviasi", () => {
  it.each([
    [3.781, "LEBIH CEPAT"],
    [-0.5, "TERLAMBAT"],
    [0.004, "SESUAI RENCANA"],
    [-0.004, "SESUAI RENCANA"],
  ] as const)("%s → %s", (dev, ket) => {
    expect(keteranganDeviasi(dev)).toBe(ket);
  });
});
