/*
 * PERIODE MINGGU DENGAN HARI MULAI BEBAS (DECISIONS 708).
 *
 * Permintaan user 2026-10-26: setelah 7 hari sejak SPMK lalu Senin–Minggu,
 * datang permintaan Jumat–Kamis – *"aku tetap butuh dinamis hari start nya"*.
 * Setiap paket memilih hari mulai minggu (Senin … Minggu) atau 7 hari sejak
 * SPMK; M1 pendek bila SPMK tidak jatuh di hari mulai.
 *
 * Yang diuji di sini SIFAT grid, untuk SETIAP hari mulai dan SETIAP hari SPMK –
 * bukan beberapa contoh saja – ditambah bukti bahwa Senin–Minggu dan 7 hari
 * tidak bergeser satu angka pun dari rumus sebelumnya.
 */
import { describe, expect, it } from "vitest";
import {
  WEEK_PERIOD_MODES,
  hariMulaiMinggu,
  modeKalender,
  totalWeeksBetween,
  weekDateRange,
  weekEndFractions,
  weekOfDate,
  type WeekPeriodMode,
} from "@/lib/progress-calc";
import { WeekMode } from "@/generated/prisma/enums";
import { LABEL_MODE_MINGGU } from "@/lib/periode-minggu";

const HARI = 86_400_000;
const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
const tambah = (d: Date, n: number) => new Date(d.getTime() + n * HARI);

const KALENDER = WEEK_PERIOD_MODES.filter((m) => modeKalender(m));
// Senin 2 Mar 2026 … Minggu 8 Mar 2026: satu SPMK untuk tiap hari dalam seminggu.
const SPMK_TIAP_HARI = Array.from({ length: 7 }, (_, i) => tambah(tgl("2026-03-02"), i));
const DURASI = [1, 6, 7, 30, 119, 120, 200];

describe("daftar periode lengkap dan sama dengan skema", () => {
  it("tujuh hari mulai + '7 hari sejak SPMK', tidak ada yang kembar", () => {
    expect(KALENDER).toHaveLength(7);
    expect(new Set(KALENDER.map((m) => hariMulaiMinggu(m))).size).toBe(7);
    expect(WEEK_PERIOD_MODES.filter((m) => !modeKalender(m))).toEqual(["tujuh_hari"]);
    expect(hariMulaiMinggu("tujuh_hari")).toBeNull();
  });

  it("sama persis dengan enum WeekMode di skema – tidak ada mode yang hanya ada di satu sisi", () => {
    expect([...WEEK_PERIOD_MODES].sort()).toEqual(Object.values(WeekMode).sort());
  });

  it("tiap periode punya label, memakai en-dash", () => {
    for (const m of WEEK_PERIOD_MODES) {
      expect(LABEL_MODE_MINGGU[m]).toBeTruthy();
      expect(LABEL_MODE_MINGGU[m]).not.toContain(String.fromCharCode(0x2014));
    }
    expect(LABEL_MODE_MINGGU.jumat_kamis).toContain("Jumat–Kamis");
  });
});

describe("sifat grid untuk SETIAP hari mulai × SETIAP hari SPMK", () => {
  for (const mode of KALENDER) {
    it(`${mode}: M1 mulai di SPMK, minggu bersambung tanpa celah, tiap minggu berikutnya mulai di hari mulai`, () => {
      const hariMulai = hariMulaiMinggu(mode)!;
      for (const spmk of SPMK_TIAP_HARI) {
        for (const durasi of DURASI) {
          const akhir = tambah(spmk, durasi - 1);
          const n = totalWeeksBetween(spmk, akhir, mode);
          let harap = spmk;
          for (let k = 1; k <= n; k++) {
            const r = weekDateRange(spmk, k, mode, akhir);
            expect(key(r.start), `${mode} SPMK ${key(spmk)} ${durasi} hari M${k}`).toBe(key(harap));
            if (k > 1) expect(r.start.getUTCDay()).toBe(hariMulai);
            const panjang = (r.end.getTime() - r.start.getTime()) / HARI + 1;
            expect(panjang).toBeGreaterThanOrEqual(1);
            expect(panjang).toBeLessThanOrEqual(7);
            // Setiap minggu kecuali yang terakhir berakhir sehari sebelum hari mulai.
            if (k < n) expect((r.end.getUTCDay() + 1) % 7).toBe(hariMulai);
            // weekOfDate membalik weekDateRange di setiap hari minggu itu.
            for (let d = r.start; d <= r.end; d = tambah(d, 1)) expect(weekOfDate(spmk, d, mode)).toBe(k);
            harap = tambah(r.end, 1);
          }
          expect(key(weekDateRange(spmk, n, mode, akhir).end)).toBe(key(akhir));
        }
      }
    });
  }

  it("tanggal sebelum SPMK = minggu 0 pada setiap periode", () => {
    for (const mode of WEEK_PERIOD_MODES) {
      for (const spmk of SPMK_TIAP_HARI) expect(weekOfDate(spmk, tambah(spmk, -1), mode)).toBe(0);
    }
  });

  it("weekEndFractions naik ketat dan berakhir 1 pada setiap periode", () => {
    for (const mode of WEEK_PERIOD_MODES) {
      for (const spmk of SPMK_TIAP_HARI) {
        const fr = weekEndFractions(spmk, tambah(spmk, 118), mode);
        expect(fr).toHaveLength(totalWeeksBetween(spmk, tambah(spmk, 118), mode));
        for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThan(fr[i - 1]);
        expect(fr[fr.length - 1]).toBe(1);
      }
    }
  });
});

describe("Jumat–Kamis – contoh yang bisa dicek dengan kalender", () => {
  it("SPMK Senin 19 Okt 2026: M1 = Senin–Kamis (4 hari), M2 = Jumat 23 – Kamis 29 Okt", () => {
    const spmk = tgl("2026-10-19");
    expect(weekDateRange(spmk, 1, "jumat_kamis")).toEqual({ start: tgl("2026-10-19"), end: tgl("2026-10-22") });
    expect(weekDateRange(spmk, 2, "jumat_kamis")).toEqual({ start: tgl("2026-10-23"), end: tgl("2026-10-29") });
    expect(weekOfDate(spmk, tgl("2026-10-22"), "jumat_kamis")).toBe(1);
    expect(weekOfDate(spmk, tgl("2026-10-23"), "jumat_kamis")).toBe(2);
  });

  it("SPMK Jumat: M1 utuh 7 hari, sama dengan 7 hari sejak SPMK", () => {
    const spmk = tgl("2026-10-23");
    for (let k = 1; k <= 10; k++) {
      expect(weekDateRange(spmk, k, "jumat_kamis")).toEqual(weekDateRange(spmk, k, "tujuh_hari"));
    }
  });
});

/*
 * Rumus SEBELUM 708, disalin apa adanya sebagai pembanding. Senin–Minggu dan
 * 7 hari dipakai seluruh kontrak berjalan: satu hari bergeser berarti nomor
 * minggu, rencana %, dan deviasi di semua laporan ikut bergeser.
 */
function seninPekanLama(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * HARI);
}
function weekOfDateLama(start: Date, date: Date, mode: "tujuh_hari" | "senin_minggu"): number {
  if (date.getTime() < start.getTime()) return 0;
  if (mode === "senin_minggu") {
    return Math.floor((seninPekanLama(date).getTime() - seninPekanLama(start).getTime()) / (7 * HARI)) + 1;
  }
  return Math.floor((date.getTime() - start.getTime()) / (7 * HARI)) + 1;
}
function weekDateRangeLama(start: Date, n: number, mode: "tujuh_hari" | "senin_minggu", end?: Date) {
  let s: Date;
  let e: Date;
  if (mode === "senin_minggu") {
    const senin1 = seninPekanLama(start);
    s = new Date(senin1.getTime() + (n - 1) * 7 * HARI);
    e = new Date(s.getTime() + 6 * HARI);
    if (s.getTime() < start.getTime()) s = start;
  } else {
    s = new Date(start.getTime() + (n - 1) * 7 * HARI);
    e = new Date(s.getTime() + 6 * HARI);
  }
  if (end && e.getTime() > end.getTime() && end.getTime() >= s.getTime()) e = end;
  return { start: s, end: e };
}

describe("Senin–Minggu dan 7 hari TIDAK bergeser dari rumus sebelumnya", () => {
  for (const mode of ["senin_minggu", "tujuh_hari"] as const satisfies readonly WeekPeriodMode[]) {
    it(`${mode}: weekOfDate & weekDateRange identik untuk 7 hari SPMK × 400 hari`, () => {
      for (const spmk of SPMK_TIAP_HARI) {
        const akhir = tambah(spmk, 150);
        for (let i = -3; i < 400; i++) {
          const d = tambah(spmk, i);
          expect(weekOfDate(spmk, d, mode)).toBe(weekOfDateLama(spmk, d, mode));
        }
        for (let k = 1; k <= 30; k++) {
          expect(weekDateRange(spmk, k, mode, akhir)).toEqual(weekDateRangeLama(spmk, k, mode, akhir));
          expect(weekDateRange(spmk, k, mode)).toEqual(weekDateRangeLama(spmk, k, mode));
        }
      }
    });
  }
});
