import { describe, expect, it } from "vitest";
import { contractMismatch, ppnAmount, valueDone, withPpn } from "@/lib/money";

describe("ppnAmount / withPpn", () => {
  it("PPN 11% dari 1 miliar = 110 juta", () => {
    expect(ppnAmount(1_000_000_000n, 11)).toBe(110_000_000n);
    expect(withPpn(1_000_000_000n, 11)).toBe(1_110_000_000n);
  });

  it("persen pecahan (11/12 style) dibulatkan ke basis 1/100", () => {
    expect(ppnAmount(1_000_000_000n, 11.5)).toBe(115_000_000n);
    expect(ppnAmount(0n, 11)).toBe(0n);
  });
});

describe("contractMismatch (toleransi 0.1%)", () => {
  const rab = 1_000_000_000n; // + PPN 11% → expected 1_110_000_000n

  it("nilai persis = tidak mismatch", () => {
    expect(contractMismatch(1_110_000_000n, rab, 11)).toBe(false);
  });

  it("selisih di dalam toleransi 0.1% = tidak mismatch", () => {
    // toleransi = 1_110_000_000 / 1000 = 1_110_000
    expect(contractMismatch(1_110_000_000n + 1_110_000n, rab, 11)).toBe(false);
    expect(contractMismatch(1_110_000_000n - 1_110_000n, rab, 11)).toBe(false);
  });

  it("selisih melebihi toleransi = mismatch", () => {
    expect(contractMismatch(1_110_000_000n + 1_110_001n, rab, 11)).toBe(true);
    expect(contractMismatch(1_110_000_000n - 1_110_001n, rab, 11)).toBe(true);
  });

  it("expected 0 → mismatch hanya bila kontrak ≠ 0", () => {
    expect(contractMismatch(0n, 0n, 11)).toBe(false);
    expect(contractMismatch(1n, 0n, 11)).toBe(true);
  });
});

describe("valueDone", () => {
  it("round(volume × hargaSatuan) sebagai BigInt", () => {
    expect(valueDone(2.5, 1_000_000)).toBe(2_500_000n);
    expect(valueDone(0.333, 1000)).toBe(333n);
    expect(valueDone(1.4999, 1)).toBe(1n); // pembulatan setengah ke atas ala Math.round
    expect(valueDone(0, 999)).toBe(0n);
  });
});
