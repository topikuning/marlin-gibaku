// PENYESUAIAN REALISASI saat adendum menurunkan volume di bawah yang dilaporkan.
//
// Permintaan user 2026-09-03: laporan harian yang sudah masuk menyesuaikan
// volume baru, dibagi PROPORSIONAL (keputusan user atas dua pilihan).
import { describe, expect, it } from "vitest";
import { sesuaikanDraftDulu, sesuaikanProporsional, sesuaikanProporsional as bagi } from "@/lib/rab/sesuaikan-realisasi";

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

/*
 * KELEBIHAN DIPOTONG DARI BARIS DRAFT DULU (DECISIONS 745). Jawaban user
 * 2026-11-06 atas pertanyaan "saat adendum disahkan dengan volume lebih kecil
 * dari yang sudah dilaporkan, apakah kelebihannya dipotong dari baris draft
 * dulu?": "ya". Baris kontrak yang sudah resmi tidak ikut turun selama
 * kelebihannya masih bisa diserap baris draft.
 */
describe("sesuaikanDraftDulu", () => {
  it("contoh pertanyaan: kontrak 100 + draft 150, disahkan 180 → 100 + 80", () => {
    expect(sesuaikanDraftDulu([100, 150], [false, true], 180)).toEqual([100, 80]);
  });

  it("beberapa baris draft: dipotong rata di antara baris draft saja, menjumlah PERSIS", () => {
    const hasil = sesuaikanDraftDulu([40, 30, 30, 50], [false, true, true, true], 100)!;
    expect(hasil[0]).toBe(40);
    expect(hasil.slice(1).reduce((t, v) => t + v, 0)).toBe(60);
    expect(hasil.reduce((t, v) => Math.round((t + v) * 1000) / 1000, 0)).toBe(100);
  });

  it("baris draft habis tapi masih lebih: draft jadi 0, sisanya dari kontrak secara proporsional", () => {
    expect(sesuaikanDraftDulu([60, 60, 10], [false, false, true], 100)).toEqual([50, 50, 0]);
  });

  it("tanpa baris draft: sama dengan proporsional lama", () => {
    expect(sesuaikanDraftDulu([30, 20, 10], [false, false, false], 30)).toEqual(sesuaikanProporsional([30, 20, 10], 30));
  });

  it("belum melebihi: null", () => {
    expect(sesuaikanDraftDulu([100, 50], [false, true], 150)).toBeNull();
    expect(sesuaikanDraftDulu([100, 50], [false, true], 200)).toBeNull();
  });
});
