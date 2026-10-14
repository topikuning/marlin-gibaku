/*
 * Tanggal selesai kontrak: SPMK + masa pelaksanaan (SPMK titik nol, DECISIONS
 * 578), dibatasi 31 Desember untuk kontrak tahun tunggal (DECISIONS 672).
 *
 * Laporan user 2026-10-13: "spmk 18 september, waktu pelaksanaan 105 hari,
 * tapi tanggal selesai jadinya 1 januari … kontrak tahun tunggal harus selesai
 * di tahun yang sama, otomatis maksimal di 31 Desember."
 */
import { describe, expect, it } from "vitest";
import { akhirKontrak, totalWeeksBetween } from "@/lib/progress-calc";

const d = (k: string) => new Date(`${k}T00:00:00.000Z`);
const kunci = (t: Date) => t.toISOString().slice(0, 10);

describe("akhirKontrak", () => {
  it("SPMK 18 September + 105 hari, tahun tunggal → 31 Desember, dan pembatasannya disebut", () => {
    const a = akhirKontrak(d("2026-09-18"), 105, false);
    expect(kunci(a.akhir)).toBe("2026-12-31");
    expect(a.dibatasi).toBe(true);
    expect(kunci(a.tanpaBatas)).toBe("2027-01-01");
  });

  it("kontrak tahun jamak tidak dibatasi", () => {
    const a = akhirKontrak(d("2026-09-18"), 105, true);
    expect(kunci(a.akhir)).toBe("2027-01-01");
    expect(a.dibatasi).toBe(false);
  });

  it("kontrak yang memang selesai di tahun yang sama tidak berubah (keputusan 578: 5 Maret + 116 = 29 Juni)", () => {
    expect(kunci(akhirKontrak(d("2026-03-05"), 116, false).akhir)).toBe("2026-06-29");
    const pas = akhirKontrak(d("2026-09-17"), 105, false);
    expect(kunci(pas.akhir)).toBe("2026-12-31");
    expect(pas.dibatasi).toBe(false);
  });

  it("kolom minggu ikut: hari 1 Januari tidak lagi membuat minggu ke-16 sendiri", () => {
    const mulai = d("2026-09-18");
    expect(totalWeeksBetween(mulai, akhirKontrak(mulai, 105, true).akhir, "tujuh_hari")).toBe(16);
    expect(totalWeeksBetween(mulai, akhirKontrak(mulai, 105, false).akhir, "tujuh_hari")).toBe(15);
  });
});
