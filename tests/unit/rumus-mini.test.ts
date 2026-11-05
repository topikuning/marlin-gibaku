import { describe, expect, it } from "vitest";
import { geserRumus, hitungRumus, type AmbilSel } from "@/lib/export/rumus-mini";

/**
 * RUMUS EXCEL MINI (DECISIONS 741): penghitung dan penggeser rumus yang dipakai
 * ekspor RAB/CCO bertaut untuk MEMBUKTIKAN rumus sebelum menulisnya. Yang tak
 * bisa dibuktikan harus `null`, bukan angka karangan.
 */

const lembar: Record<string, Record<string, number | string | null>> = {
  "": { A1: 2, B1: 3, C1: 4, A2: 10, A3: 20, A4: "teks", A5: null, D1: 0.15 },
  "Bahan & Upah": { C5: 1500, C6: 2500.5 },
  "7. Vol Kios 3x4": { M95: 12.5 },
};
const ambil: AmbilSel = (sheet, c, r) => lembar[sheet ?? ""]?.[`${String.fromCharCode(64 + c)}${r}`];

describe("hitungRumus", () => {
  it("aritmetika, kurung, persen, pangkat, unari", () => {
    expect(hitungRumus("=A1*B1*C1", ambil)).toBe(24);
    expect(hitungRumus("=(A1+B1)*C1-A2/A1", ambil)).toBe(15);
    expect(hitungRumus("=A2*15%", ambil)).toBe(1.5);
    expect(hitungRumus("=-A1^2", ambil)).toBe(4);
    expect(hitungRumus("=A1*(1+D1)", ambil)).toBeCloseTo(2.3, 10);
  });

  it("fungsi dan rentang; sel kosong = 0 dalam aritmetika, teks dilewati SUM", () => {
    expect(hitungRumus("=SUM(A2:A5)", ambil)).toBe(30);
    expect(hitungRumus("=SUM(A1:C1)+PRODUCT(A1,B1)", ambil)).toBe(15);
    expect(hitungRumus("=A5+1", ambil)).toBe(1);
    expect(hitungRumus("=MAX(A1:C1)-MIN(A1:C1)", ambil)).toBe(2);
  });

  it("pembulatan ala Excel, termasuk digit negatif dan galat biner", () => {
    expect(hitungRumus("=ROUND(2.675,2)", ambil)).toBe(2.68);
    expect(hitungRumus("=ROUND(-2.5,0)", ambil)).toBe(-3);
    expect(hitungRumus("=ROUNDDOWN(1234567,-3)", ambil)).toBe(1234000);
    expect(hitungRumus("=ROUNDUP(1.001,1)", ambil)).toBe(1.1);
  });

  it("rujukan sheet lain, dengan dan tanpa kutip; $ diabaikan", () => {
    expect(hitungRumus("='Bahan & Upah'!$C$5*2", ambil)).toBe(3000);
    expect(hitungRumus("='7. Vol Kios 3x4'!M95", ambil)).toBe(12.5);
  });

  it("yang tidak bisa dibuktikan → null", () => {
    expect(hitungRumus('=IF(A1>1,1,0)', ambil)).toBeNull(); // perbandingan
    expect(hitungRumus("=VLOOKUP(A1,B1:C1,2)", ambil)).toBeNull(); // fungsi tak dikenal
    expect(hitungRumus('="a"&"b"', ambil)).toBeNull(); // teks
    expect(hitungRumus("=A4*2", ambil)).toBeNull(); // teks dalam aritmetika
    expect(hitungRumus("=A1/0", ambil)).toBeNull(); // bagi nol
    expect(hitungRumus("=HARGA_SEMEN*2", ambil)).toBeNull(); // nama terdefinisi
    expect(hitungRumus("=[1]Sheet1!A1", ambil)).toBeNull(); // berkas lain
    expect(hitungRumus("=SUM(A1:A3", ambil)).toBeNull(); // kurung tak tertutup
  });
});

describe("geserRumus", () => {
  // Blok baris 80–95 berkas pindah ke baris 10–25 lembar MARLIN, kolom tetap.
  const peta = (sheet: string | null, c: number, r: number) =>
    sheet == null && r >= 80 && r <= 95 ? { sheet: null, c, r: r - 70 } : null;

  it("sel dan rentang di dalam blok bergeser utuh", () => {
    expect(geserRumus("=SUM(M80:M94)", peta)).toBe("SUM(M10:M24)");
    expect(geserRumus("=$E$81*F81*G81", peta)).toBe("E11*F11*G11");
    expect(geserRumus("=ROUND(M95,2)", peta)).toBe("ROUND(M25,2)");
  });

  it("rujukan ke luar blok, ke sheet lain, atau rentang yang tidak utuh → null", () => {
    expect(geserRumus("=M79+M80", peta)).toBeNull();
    expect(geserRumus("='Bahan & Upah'!C5*M80", peta)).toBeNull();
    expect(geserRumus("=SUM(M70:M90)", peta)).toBeNull();
    expect(geserRumus("=IF(M80>0,1,0)", peta)).toBeNull();
  });

  it("hasil geser menghitung angka yang sama dengan aslinya", () => {
    const asli: Record<string, number> = { M80: 1.5, M81: 2.25, M82: 3 };
    const baru: Record<string, number> = { M10: 1.5, M11: 2.25, M12: 3 };
    const a: AmbilSel = (_s, c, r) => asli[`${String.fromCharCode(64 + c)}${r}`];
    const b: AmbilSel = (_s, c, r) => baru[`${String.fromCharCode(64 + c)}${r}`];
    const rumus = "=SUM(M80:M82)*2";
    expect(hitungRumus(geserRumus(rumus, peta)!, b)).toBe(hitungRumus(rumus, a));
  });

  it("pemetaan ke sheet lain diberi kutip bila perlu", () => {
    const keLain = (_s: string | null, c: number, r: number) => ({ sheet: "Bahan & Upah", c, r: r + 1 });
    expect(geserRumus("=C4*2", keLain)).toBe("'Bahan & Upah'!C5*2");
  });
});
