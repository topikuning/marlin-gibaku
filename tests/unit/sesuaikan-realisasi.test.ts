// PENYESUAIAN REALISASI saat adendum menurunkan volume di bawah yang dilaporkan.
//
// Permintaan user 2026-09-03: laporan harian yang sudah masuk menyesuaikan
// volume baru, dibagi PROPORSIONAL (keputusan user atas dua pilihan).
import { describe, expect, it } from "vitest";
import { sesuaikanProporsional as bagi } from "@/lib/rab/sesuaikan-realisasi";

const jumlah = (xs: number[]) => Math.round(xs.reduce((t, v) => t + v, 0) * 1000) / 1000;

describe("KASUS USER: 45,7 turun jadi 32,15", () => {
  it("tiga laporan dibagi proporsional dan menjumlah PERSIS", () => {
    const hasil = bagi([20, 15.7, 10], 32.15)!;
    expect(jumlah(hasil)).toBe(32.15);
    // Porsinya tetap: yang terbesar tetap terbesar.
    expect(hasil[0]).toBeGreaterThan(hasil[1]!);
    expect(hasil[1]).toBeGreaterThan(hasil[2]!);
  });

  it("satu laporan tunggal: langsung jadi volume barunya", () => {
    expect(bagi([45.7], 32.15)).toEqual([32.15]);
  });
});

describe("penjumlahannya PERSIS, bukan mendekati", () => {
  it("angka yang tidak habis dibagi tetap menjumlah tepat", () => {
    // 1/3 masing-masing: pembulatan naif meninggalkan sisa 1 mili.
    const hasil = bagi([10, 10, 10], 10)!;
    expect(jumlah(hasil)).toBe(10);
  });

  it("banyak baris kecil tetap menjumlah tepat", () => {
    const banyak = Array.from({ length: 37 }, (_, i) => 1 + i * 0.137);
    const hasil = bagi(banyak, 12.345)!;
    expect(jumlah(hasil)).toBe(12.345);
    expect(hasil).toHaveLength(37);
  });

  it("target nol menihilkan semuanya, dan tetap menjumlah nol", () => {
    const hasil = bagi([20, 15.7, 10], 0)!;
    expect(jumlah(hasil)).toBe(0);
    expect(hasil.every((v) => v === 0)).toBe(true);
  });
});

describe("yang TIDAK boleh disentuh", () => {
  it("realisasi masih di bawah volume baru: null, bukan angka yang ditulis ulang", () => {
    expect(bagi([10, 5], 32.15)).toBeNull();
  });

  it("pas sama dengan volume baru: null", () => {
    expect(bagi([20, 12.15], 32.15)).toBeNull();
  });

  it("adendum yang MENAIKKAN volume tidak menggelembungkan laporan", () => {
    expect(bagi([20, 15.7], 100)).toBeNull();
  });

  it("tidak ada laporan sama sekali: null", () => {
    expect(bagi([], 32.15)).toBeNull();
  });

  it("total nol tidak dibagi (mustahil menskalakan nol)", () => {
    expect(bagi([0, 0], 0)).toBeNull();
  });
});

describe("koreksi bervolume negatif ikut terskala, tidak diabaikan", () => {
  it("baris negatif tetap negatif dan totalnya tetap persis", () => {
    // Laporan koreksi bisa bervolume negatif (lihat komentar batas bawah di
    // progress.ts). Membiarkannya di luar skala membuat totalnya meleset.
    const hasil = bagi([30, -5], 20)!;
    expect(jumlah(hasil)).toBe(20);
    expect(hasil[1]).toBeLessThan(0);
  });
});
