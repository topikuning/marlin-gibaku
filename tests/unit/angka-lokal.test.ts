// SATU pembaca angka untuk seluruh jalur impor Excel.
//
// Audit 2026-09-01: dua parser di repo yang sama memakai konvensi desimal yang
// BERLAWANAN pada sel yang sama, jadi berkas yang sah dibaca 10x lipat di satu
// jalur dan hilang diam-diam di jalur lain.
import { describe, expect, it } from "vitest";
import { bacaAngkaLokal as baca } from "@/lib/rab/angka-lokal";

describe("format Indonesia dibaca benar di KEDUA jalur", () => {
  it("koma = desimal, titik = ribuan", () => {
    expect(baca("1.500.000,50")).toBe(1_500_000.5);
    expect(baca("1,5")).toBe(1.5);
    expect(baca("1.500,75")).toBe(1500.75);
  });

  it("tanpa koma, dua titik atau lebih = ribuan (tidak mungkin dua desimal)", () => {
    expect(baca("1.500.000")).toBe(1_500_000);
    expect(baca("Rp 1.500.000")).toBe(1_500_000);
  });

  it("tanpa koma, satu titik = desimal – sengaja sama dengan perilaku lama", () => {
    // Ambigu dan diakui: 3.333 bisa berarti 3,333 m3 (Decimal(15,3)) atau
    // 3333. Diselesaikan dengan TIDAK menebak, bukan dengan menebak.
    expect(baca("12.5")).toBe(12.5);
    expect(baca("3.333")).toBe(3.333);
  });

  it("angka apa adanya lewat tanpa disentuh", () => {
    expect(baca(1_000_000.4)).toBe(1_000_000.4);
    expect(baca(0)).toBe(0);
    expect(baca(-3)).toBe(-3);
  });
});

describe("yang tidak dikenali menjadi null, TIDAK PERNAH 0", () => {
  it("sel kosong, spasi, dan teks tanpa angka", () => {
    // Em-dash sengaja tidak ikut didaftar di sini: penjaga `tanda-pisah-ui`
    // menyapu seluruh literal di repo, termasuk berkas uji.
    for (const v of [null, undefined, "", "   ", "n/a", "TBD", "-", "–", "?"]) {
      expect(baca(v), `${JSON.stringify(v)} seharusnya null`).toBeNull();
    }
  });

  it("sel galat Excel", () => {
    expect(baca({ error: "#REF!" })).toBeNull();
    expect(baca({ error: "#VALUE!" })).toBeNull();
  });

  it("rumus TANPA hasil ter-cache", () => {
    expect(baca({ formula: "G10*E10" })).toBeNull();
    expect(baca({ formula: "G10*E10", result: 2_500_000 })).toBe(2_500_000);
    // Rumus yang hasilnya galat juga null.
    expect(baca({ formula: "A1/0", result: { error: "#DIV/0!" } })).toBeNull();
  });

  it("sel tanggal bukan angka pekerjaan", () => {
    expect(baca(new Date("2026-07-01"))).toBeNull();
  });

  it("richText diambil teksnya, dan tetap null bila bukan angka", () => {
    expect(baca({ richText: [{ text: "1.500" }, { text: ",5" }] })).toBe(1500.5);
    expect(baca({ richText: [{ text: "lihat catatan" }] })).toBeNull();
  });

  it("boolean bukan angka", () => {
    expect(baca(true)).toBeNull();
    expect(baca(false)).toBeNull();
  });
});

describe("angka negatif", () => {
  it("minus di depan dipertahankan", () => {
    expect(baca("-1.500,25")).toBe(-1500.25);
    // Kurung akuntansi. Sengaja memakai angka yang TIDAK ambigu: "(1.500)"
    // jatuh tepat di kasus satu-titik yang aturannya menolak tebak, jadi ia
    // bernilai -1,5 - konsisten dengan aturannya, dan bukan kasus yang layak
    // dipakai menjelaskan tanda minus.
    expect(baca("(1.500,25)")).toBe(-1500.25);
    expect(baca("(1.500.000)")).toBe(-1_500_000);
  });
});
