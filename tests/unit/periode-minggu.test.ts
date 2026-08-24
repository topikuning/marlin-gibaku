/*
 * PERIODE MINGGU LAPORAN (user 2026-08-24) – dua mode per kontrak:
 *
 *   tujuh_hari   : minggu ke-n = [SPMK + (n−1)×7 hari, +6 hari] (perilaku lama)
 *   senin_minggu : minggu KALENDER Senin–Minggu; M1 bisa pendek
 *                  (SPMK Kamis ⇒ M1 = Kamis–Minggu, 4 hari)
 *
 * Contoh acuan dari permintaan user: "kalau tanggal pertama SPMK adalah hari
 * kamis, maka minggu pertama cuma 4 hari (Kamis - Minggu)". Kasus di bawah
 * memakai SPMK Kamis 2026-03-05 persis untuk itu.
 */
import { describe, expect, it } from "vitest";
import { totalWeeksBetween, weekDateRange, weekOfDate } from "@/lib/progress-calc";

const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);

// SPMK Kamis (2026-03-05 = Kamis).
const SPMK = tgl("2026-03-05");

describe("mode tujuh_hari – perilaku lama tidak berubah", () => {
  it("minggu ke-n selalu 7 hari sejak SPMK", () => {
    expect(weekDateRange(SPMK, 1, "tujuh_hari")).toEqual({ start: tgl("2026-03-05"), end: tgl("2026-03-11") });
    expect(weekDateRange(SPMK, 2, "tujuh_hari")).toEqual({ start: tgl("2026-03-12"), end: tgl("2026-03-18") });
  });

  it("weekOfDate membalik weekDateRange", () => {
    for (let n = 1; n <= 5; n++) {
      const r = weekDateRange(SPMK, n, "tujuh_hari");
      expect(weekOfDate(SPMK, r.start, "tujuh_hari")).toBe(n);
      expect(weekOfDate(SPMK, r.end, "tujuh_hari")).toBe(n);
    }
  });

  it("120 hari = 18 kolom minggu (ceil 120/7)", () => {
    const end = new Date(SPMK.getTime() + 119 * 86_400_000);
    expect(totalWeeksBetween(SPMK, end, "tujuh_hari")).toBe(18);
  });
});

describe("mode senin_minggu – minggu kalender", () => {
  it("SPMK Kamis: M1 = Kamis–Minggu (4 hari), M2 mulai Senin", () => {
    const m1 = weekDateRange(SPMK, 1, "senin_minggu");
    expect(key(m1.start)).toBe("2026-03-05"); // Kamis (SPMK, bukan Senin-nya)
    expect(key(m1.end)).toBe("2026-03-08"); // Minggu
    const m2 = weekDateRange(SPMK, 2, "senin_minggu");
    expect(key(m2.start)).toBe("2026-03-09"); // Senin
    expect(key(m2.end)).toBe("2026-03-15"); // Minggu
  });

  it("SPMK hari Senin: M1 utuh 7 hari – identik dgn mode lama", () => {
    const senin = tgl("2026-03-02");
    const m1 = weekDateRange(senin, 1, "senin_minggu");
    expect(key(m1.start)).toBe("2026-03-02");
    expect(key(m1.end)).toBe("2026-03-08");
  });

  it("weekOfDate membalik weekDateRange di kedua ujungnya", () => {
    for (let n = 1; n <= 5; n++) {
      const r = weekDateRange(SPMK, n, "senin_minggu");
      expect(weekOfDate(SPMK, r.start, "senin_minggu")).toBe(n);
      expect(weekOfDate(SPMK, r.end, "senin_minggu")).toBe(n);
    }
  });

  it("tanggal sebelum SPMK = minggu 0 (belum mulai)", () => {
    expect(weekOfDate(SPMK, tgl("2026-03-04"), "senin_minggu")).toBe(0);
    expect(weekOfDate(SPMK, tgl("2026-03-01"), "tujuh_hari")).toBe(0);
  });

  it("119 hari dari Kamis: 18 kolom (M1 pendek menambah satu kolom atas ceil)", () => {
    // 119 hari: 4 (Kamis–Minggu) + 115; ceil(115/7)=17 minggu penuh → 18 kolom.
    const end = new Date(SPMK.getTime() + 118 * 86_400_000);
    expect(totalWeeksBetween(SPMK, end, "senin_minggu")).toBe(18);
    expect(totalWeeksBetween(SPMK, end, "tujuh_hari")).toBe(17);
  });

  it("minggu terakhir dipangkas ke akhir kontrak bila `end` diberikan", () => {
    const end = tgl("2026-03-17"); // Selasa
    const m3 = weekDateRange(SPMK, 3, "senin_minggu", end);
    expect(key(m3.start)).toBe("2026-03-16"); // Senin
    expect(key(m3.end)).toBe("2026-03-17"); // dipangkas, bukan Minggu
  });
});
