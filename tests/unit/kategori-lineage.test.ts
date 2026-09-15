// IDENTITAS KATEGORI DARI lineageKey (audit 2026-09-15, D-2/G-5).
//
// `lineageKey` bukan path yang boleh dipotong di "#": tanda itu memikul dua arti
// sekaligus — pemisah jenjang DAN sufiks pembeda kode kembar ("VI#2" = kategori
// romawi VI yang KEDUA). `split("#")[0]` melebur keduanya, dan akibatnya terukur
// di blanko KKP: realisasi kategori kedua masuk ke subtotal kategori pertama
// sementara kolom rencananya tetap di kategori kedua.
import { describe, expect, it } from "vitest";
import { kategoriDariLineage, kategoriDariLineageAtau } from "@/lib/rab/kategori-lineage";

// Bentuk yang nyata di data HPS: dua kategori berkode romawi sama.
const KATEGORI = ["I", "VI", "VI#2", "VI#3", "VII"];

describe("kategoriDariLineage", () => {
  it("item biasa mendapat kategorinya", () => {
    expect(kategoriDariLineage("I#6.1#a", KATEGORI)).toBe("I");
    expect(kategoriDariLineage("VII#1", KATEGORI)).toBe("VII");
  });

  it("KASUS YANG MERUSAK: kategori romawi ganda tidak dilebur", () => {
    expect(kategoriDariLineage("VI#2", KATEGORI)).toBe("VI#2");
    expect(kategoriDariLineage("VI#2#1", KATEGORI)).toBe("VI#2");
    expect(kategoriDariLineage("VI#3#1", KATEGORI)).toBe("VI#3");
    // Yang memang milik kategori pertama tetap di sana.
    expect(kategoriDariLineage("VI#1", KATEGORI)).toBe("VI");
  });

  it("batas '#' menjaga VI tidak menyambar VII", () => {
    expect(kategoriDariLineage("VII", KATEGORI)).toBe("VII");
    expect(kategoriDariLineage("VIII#1", KATEGORI)).toBeNull();
  });

  it("tanpa kategori yang cocok → null, bukan tebakan", () => {
    expect(kategoriDariLineage("ZZ#1", KATEGORI)).toBeNull();
    expect(kategoriDariLineage("I#1", [])).toBeNull();
  });
});

describe("kategoriDariLineageAtau", () => {
  it("jatuh ke segmen pertama hanya bila tidak ada yang cocok", () => {
    expect(kategoriDariLineageAtau("VI#2#1", KATEGORI)).toBe("VI#2");
    expect(kategoriDariLineageAtau("ZZ#1", KATEGORI)).toBe("ZZ");
  });
});
