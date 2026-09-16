// PEMBACA NOMINAL RUPIAH YANG DIKETIK ORANG (audit 2026-09-15, J-1).
//
// Aturan lama membuang SEMUA titik dan koma, jadi nominal yang disalin dari
// invoice vendor dalam format Indonesia berubah seratus kali lipat tanpa suara:
// "1.500.000,00" tersimpan sebagai Rp 150.000.000. DECISIONS 203 melarang angka
// pengguna dibetulkan diam-diam — dan mengalikannya 100× jauh lebih buruk.
import { describe, expect, it } from "vitest";
import { bacaRupiah } from "@/lib/finance/rupiah";

const nilai = (s: string) => {
  const r = bacaRupiah(s);
  return r.ok ? r.nilai : null;
};
const pesan = (s: string) => {
  const r = bacaRupiah(s);
  return r.ok ? null : r.pesan;
};

describe("nominal yang PASTI artinya", () => {
  it("angka polos, dengan atau tanpa hiasan mata uang", () => {
    expect(nilai("1500000")).toBe(1_500_000n);
    expect(nilai("Rp 1500000")).toBe(1_500_000n);
    expect(nilai("  IDR1500000  ")).toBe(1_500_000n);
  });

  it("titik sebagai pemisah ribuan Indonesia", () => {
    expect(nilai("1.500")).toBe(1_500n);
    expect(nilai("1.500.000")).toBe(1_500_000n);
    expect(nilai("Rp 12.345.678")).toBe(12_345_678n);
  });

  it("KASUS YANG MERUSAK: koma desimal nol tidak lagi menggandakan nilai", () => {
    // Inilah yang dilaporkan: "1.500.000,00" pernah tersimpan 150.000.000.
    expect(nilai("1.500.000,00")).toBe(1_500_000n);
    expect(nilai("1500000,0")).toBe(1_500_000n);
    expect(nilai("1.500.000,")).toBe(1_500_000n);
  });
});

describe("yang ambigu DITOLAK, bukan ditebak", () => {
  it("pecahan bukan nol ditolak dengan menyebut sebabnya", () => {
    expect(nilai("15.000,50")).toBeNull();
    expect(pesan("15.000,50")).toContain("bilangan bulat");
    // Nilai yang ditolak ikut disebut, supaya orangnya tahu yang mana.
    expect(pesan("15.000,50")).toContain("15.000,50");
  });

  it("titik yang tidak membentuk kelompok ribuan ditolak", () => {
    // "1.5" bisa berarti satu setengah atau lima belas ribu – dua-duanya masuk
    // akal, jadi tidak boleh ada yang dipilih diam-diam.
    expect(nilai("1.5")).toBeNull();
    expect(nilai("12.34")).toBeNull();
    expect(nilai("1.5000")).toBeNull();
    expect(pesan("1.5")).toContain("pemisah ribuan");
  });

  it("dua koma, kosong, dan teks berangka ditolak", () => {
    expect(nilai("1,5,0")).toBeNull();
    expect(nilai("")).toBeNull();
    expect(nilai("   ")).toBeNull();
    expect(nilai("NIP 199106202015031001")).toBeNull();
    expect(nilai("Termin 2")).toBeNull();
  });
});
