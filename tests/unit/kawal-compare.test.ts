import { describe, expect, it } from "vitest";
import { bandingkanProgres, formatSelisihPp } from "@/lib/kawal/compare";

/**
 * SELISIH PROGRES MARLIN vs KAWAL (DECISIONS 691): MARLIN − Kawal, arah selalu
 * ditulis, ambang 5/10 pp, pagar minggu-0.
 */
describe("bandingkan progres MARLIN vs Kawal", () => {
  it("contoh brief: MARLIN 10%, Kawal 6% → +4 pp, MARLIN lebih tinggi, masih wajar", () => {
    expect(bandingkanProgres(10, 6, 8)).toEqual({ selisihPp: 4, arah: "marlin_lebih_tinggi", tingkat: "wajar" });
  });

  it("ambang tepat 5 pp = tinggi, tepat 10 pp = kritis, ke arah mana pun", () => {
    expect(bandingkanProgres(20, 15, 8).tingkat).toBe("tinggi");
    expect(bandingkanProgres(15, 25, 8)).toEqual({ selisihPp: -10, arah: "kawal_lebih_tinggi", tingkat: "kritis" });
  });

  it("pembulatan ke 0,01 pp tidak membuat 4,999 jadi tinggi", () => {
    expect(bandingkanProgres(10.004, 5.0089, 8)).toMatchObject({ selisihPp: 5, tingkat: "tinggi" });
    expect(bandingkanProgres(10.004, 5.0141, 8)).toMatchObject({ selisihPp: 4.99, tingkat: "wajar" });
  });

  it("pagar minggu-0: selisih tetap dihitung tapi tidak dinilai", () => {
    expect(bandingkanProgres(12, 0, 0)).toEqual({
      selisihPp: 12,
      arah: "marlin_lebih_tinggi",
      tingkat: "tidak_dinilai",
    });
    expect(bandingkanProgres(12, 0, null).tingkat).toBe("tidak_dinilai");
  });

  it("angka kosong → tidak bisa dihitung", () => {
    expect(bandingkanProgres(null, 6, 8)).toEqual({ selisihPp: null, arah: null, tingkat: "tidak_dinilai" });
    expect(bandingkanProgres(10, null, 8).selisihPp).toBeNull();
  });

  it("format pp selalu bertanda", () => {
    expect(formatSelisihPp(4.25)).toBe("+4,25 pp");
    expect(formatSelisihPp(-3.1)).toBe("−3,10 pp");
    expect(formatSelisihPp(0)).toBe("0,00 pp");
  });
});
