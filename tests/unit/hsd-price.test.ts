import { describe, expect, it } from "vitest";
import { BATAS_HARGA_RUPIAH, bacaRupiah } from "@/lib/ahsp/hsd-price";

describe("bacaRupiah HSD", () => {
  it("membaca format rupiah umum menjadi BigInt", () => {
    expect(bacaRupiah("Rp 1.250.000")).toBe(1_250_000n);
    expect(bacaRupiah("1250000")).toBe(1_250_000n);
  });

  it("memperlakukan kosong dan nol sebagai belum berharga", () => {
    expect(bacaRupiah(" ")).toBeNull();
    expect(bacaRupiah("0")).toBeNull();
  });

  it("menolak nilai negatif dan nominal di atas batas", () => {
    expect(bacaRupiah("-5000")).toBe("salah");
    expect(bacaRupiah(String(BATAS_HARGA_RUPIAH + 1n))).toBe("salah");
  });
});
