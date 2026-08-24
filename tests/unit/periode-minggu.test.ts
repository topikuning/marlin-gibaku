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

/* ── Generator kurva-S sadar-grid (DECISIONS 427b) ───────────────────────────
   Keberatan user 2026-08-24: generator otomatis harus KONSISTEN dengan mode
   minggu — M1 pendek tidak boleh mendapat porsi rencana minggu penuh. */
import { weekEndFractions } from "@/lib/progress-calc";
import {
  categoryWeeklyIncrements,
  cumulativeFromSegments,
  weeklyFromSegments,
} from "@/lib/scurve/generate";
import { autoCategoryWindowFrac, scheduleFromItems } from "@/lib/scurve/sequencing";

describe("weekEndFractions – grid hari per minggu", () => {
  it("SPMK Kamis, 119 hari: 18 elemen, naik ketat, M1 = 4/119, akhir = 1", () => {
    const end = new Date(SPMK.getTime() + 118 * 86_400_000);
    const fr = weekEndFractions(SPMK, end, "senin_minggu");
    expect(fr).toHaveLength(18);
    expect(fr[0]).toBeCloseTo(4 / 119, 10);
    expect(fr[1]).toBeCloseTo(11 / 119, 10);
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThan(fr[i - 1]);
    expect(fr[fr.length - 1]).toBe(1);
  });
});

describe("generator ditimbang HARI, bukan indeks minggu", () => {
  const end = new Date(SPMK.getTime() + 118 * 86_400_000);
  const fr = weekEndFractions(SPMK, end, "senin_minggu");

  it("tanpa grid = rumus lama persis (angka tujuh_hari tidak bergeser)", () => {
    const seragam = categoryWeeklyIncrements(10, 1, 4, 18);
    const eksplisit = categoryWeeklyIncrements(10, 1, 4, 18, null);
    expect(eksplisit).toEqual(seragam);
  });

  it("M1 pendek mendapat porsi LEBIH KECIL daripada versi seragam", () => {
    const seragam = categoryWeeklyIncrements(10, 1, 4, 18);
    const berGrid = categoryWeeklyIncrements(10, 1, 4, 18, fr);
    expect(berGrid[0]).toBeLessThan(seragam[0]);
    // Total bobot jendela tetap utuh.
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    expect(sum(berGrid)).toBeCloseTo(10, 6);
    expect(sum(seragam)).toBeCloseTo(10, 6);
  });

  it("kurva kumulatif ber-grid: monoton, mulai rendah, akhir 100", () => {
    const curve = cumulativeFromSegments([{ weightPct: 100, start: 0, end: 1 }], 18, fr);
    expect(curve).toHaveLength(18);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    expect(curve[17]).toBe(100);
    // Titik M1 ber-grid < titik M1 seragam: minggu 4 hari baru menempuh 4/119 durasi.
    const seragam = cumulativeFromSegments([{ weightPct: 100, start: 0, end: 1 }], 18);
    expect(curve[0]).toBeLessThan(seragam[0]);
  });

  it("weeklyFromSegments ber-grid: Σ tetap = bobot", () => {
    const w = weeklyFromSegments(25, [{ startWeek: 1, endWeek: 6 }, { startWeek: 9, endWeek: 12 }], 18, fr);
    expect(w).toHaveLength(18);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(25, 6);
    expect(w[6]).toBe(0); // minggu jeda tetap jeda
  });

  it("scheduleFromItems ber-grid: panjang matriks = jumlah kolom grid, Σ = 100", () => {
    const items = [
      { name: "Galian tanah", categoryKey: "I", categoryName: "PEKERJAAN TANAH", amount: 40_000_000n },
      { name: "Pasangan bata", categoryKey: "II", categoryName: "PEKERJAAN DINDING", amount: 60_000_000n },
    ];
    const winFrac = (name: string): [number, number] => autoCategoryWindowFrac(name);
    const sched = scheduleFromItems(items, 119, winFrac, fr);
    expect(sched.totalWeeks).toBe(18);
    for (const c of sched.categories) expect(c.weekly).toHaveLength(18);
    const total = sched.categories.reduce((s, c) => s + c.weekly.reduce((a, b) => a + b, 0), 0);
    expect(total).toBeCloseTo(100, 4);
  });
});
