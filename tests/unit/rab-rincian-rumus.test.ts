/*
 * RUJUKAN RUMUS untuk pelacak backup volume & analisa (DECISIONS baru 2026-10-06).
 *
 * Pelacak mengikuti rumus yang DITULIS penyusun berkas, jadi pembacaan
 * rujukannya harus tepat: salah membaca satu `$` atau satu rumus bersama =
 * rincian item lain yang tertempel.
 */
import { describe, expect, it } from "vitest";
import { rujukanDalam, rujukanTunggal } from "@/lib/rab/rincian/rumus";
import { geserRumus } from "@/lib/rab/rincian/xlsx-ringan";

describe("rujukanDalam", () => {
  it("sel bersheet berkutip, $ mutlak, dan rentang", () => {
    expect(rujukanDalam("'7. Vol Kios 3x4'!$M$95")).toEqual([{ sheet: "7. Vol Kios 3x4", c1: 13, r1: 95, c2: 13, r2: 95 }]);
    expect(rujukanDalam("=SUM(G7:G11)")).toEqual([{ sheet: null, c1: 7, r1: 7, c2: 7, r2: 11 }]);
    expect(rujukanDalam("'Bahan & Upah'!C$336*D7")).toEqual([
      { sheet: "Bahan & Upah", c1: 3, r1: 336, c2: 3, r2: 336 },
      { sheet: null, c1: 4, r1: 7, c2: 4, r2: 7 },
    ]);
    expect(rujukanDalam("ANALISA!G31")).toEqual([{ sheet: "ANALISA", c1: 7, r1: 31, c2: 7, r2: 31 }]);
  });

  it("nama fungsi, teks berkutip, dan berkas lain tidak dibaca sebagai sel", () => {
    expect(rujukanDalam('=ROUNDUP(LOG10(A1),2)&"B2"')).toEqual([{ sheet: null, c1: 1, r1: 1, c2: 1, r2: 1 }]);
    expect(rujukanDalam("[1]Sheet1!A1+B2")).toEqual([{ sheet: null, c1: 2, r1: 2, c2: 2, r2: 2 }]);
  });

  it("nama sheet berkutip yang memuat kutip ganda", () => {
    expect(rujukanDalam("'O''Brien'!A1")).toEqual([{ sheet: "O'Brien", c1: 1, r1: 1, c2: 1, r2: 1 }]);
  });
});

describe("rujukanTunggal", () => {
  it("hanya rumus yang isinya SATU sel", () => {
    expect(rujukanTunggal("'Resume Analisa'!$E$56")).toMatchObject({ sheet: "Resume Analisa", c1: 5, r1: 56 });
    expect(rujukanTunggal("(RABX!G10)")).toMatchObject({ sheet: "RABX", c1: 7, r1: 10 });
    expect(rujukanTunggal("E405")).toMatchObject({ sheet: null, c1: 5, r1: 405 });
    expect(rujukanTunggal("1/3*T433")).toBeNull();
    expect(rujukanTunggal("K1479+E1479")).toBeNull();
    expect(rujukanTunggal("ROUND((K14),2)")).toBeNull();
    expect(rujukanTunggal("A1:A3")).toBeNull();
  });
});

describe("geserRumus (rumus bersama)", () => {
  it("rujukan relatif bergeser, yang ber-$ tetap", () => {
    expect(geserRumus("ROUND((K27),2)", 2, 0)).toBe("ROUND((K29),2)");
    expect(geserRumus("(G7/G$29)*H7", 3, 0)).toBe("(G10/G$29)*H10");
    expect(geserRumus("'Bahan & Upah'!C$336*$D7", 1, 1)).toBe("'Bahan & Upah'!D$336*$D8");
    expect(geserRumus('"A1"&B2', 1, 0)).toBe('"A1"&B3');
  });
});
