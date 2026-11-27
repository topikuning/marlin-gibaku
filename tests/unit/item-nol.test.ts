// ITEM RAB YANG DINOLKAN (DECISIONS 798).
//
// Ketetapan user 2026-11-27: item bervolume 0 di RAB aktif tidak muncul di mana
// pun kecuali di perbandingan. Satu definisi, dipakai semua pemakai.
import { describe, expect, it } from "vitest";
import { itemDinolkan, tanpaSimpulNol, volumeNol } from "@/lib/rab/item-nol";

describe("itemDinolkan", () => {
  it("volume 0 dan nilai 0 = dinolkan, apa pun bentuk angkanya", () => {
    expect(itemDinolkan({ volume: 0, amount: 0n })).toBe(true);
    expect(itemDinolkan({ volume: "0.000", amount: "0" })).toBe(true);
    expect(itemDinolkan({ volume: null, amount: 0 })).toBe(true);
    expect(itemDinolkan({ volume: 0.0004, amount: 0n })).toBe(true);
  });

  it("bervolume, atau bernilai tanpa volume (lumsum), BUKAN dinolkan", () => {
    expect(itemDinolkan({ volume: 0.001, amount: 0n })).toBe(false);
    expect(itemDinolkan({ volume: 12.5, amount: 1_250_000n })).toBe(false);
    expect(itemDinolkan({ volume: 0, amount: 5_000_000n })).toBe(false);
  });

  it("ambang volume = setengah satuan terkecil kolom (0,0005)", () => {
    expect(volumeNol(0.0005)).toBe(false);
    expect(volumeNol(-0.0001)).toBe(true);
  });
});

describe("tanpaSimpulNol", () => {
  const n = (id: string, parentId: string | null, volume: number | null, amount: number) => ({ id, parentId, volume, amount });

  it("kategori yang seluruh isinya dinolkan ikut hilang; kategori lain hanya kehilangan item nolnya", () => {
    const pohon = [
      n("I", null, null, 30),
      n("I.1", "I", 10, 30),
      n("I.2", "I", 0, 0),
      n("II", null, null, 0), // Tambatan dinolkan CCO
      n("II.1", "II", null, 0),
      n("II.1.a", "II.1", 0, 0),
      n("II.1.b", "II.1", 0, 0),
      n("III", null, null, 50),
      n("III.1", "III", 0, 50), // lumsum: tetap
    ];
    expect(tanpaSimpulNol(pohon).map((x) => x.id)).toEqual(["I", "I.1", "III", "III.1"]);
  });
});
