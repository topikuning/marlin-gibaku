// PENGELOMPOKAN PENANDA BISA DIMATIKAN, DAN HILANGNYA PILIHAN DIKATAKAN.
//
// Pertanyaan user 2026-09-06: *"apa tujuan dilakukan grouping begini? ini bisa
// diatur atau tidak, dan tadi sepertinya ada pilihan untuk tampilan satelite,
// kenapa sekarang malah tidak ada"*.
//
// Dua hal berbeda, dua-duanya sah:
//
//   1. Berkelompok berguna pada tampilan nasional (sistem ini menuju 200+
//      lokasi di 7 provinsi; ratusan pin yang saling menimpa bukan informasi),
//      tapi ia MENYEMBUNYIKAN titik yang sedang dicari orang. Jadi pilihan.
//   2. Tombol Peta/Satelit memang hilang begitu salah satu sumber tidak ada
//      lagi — dan itu benar. Yang salah: hilang DIAM-DIAM, sehingga terbaca
//      sebagai fitur yang dicabut, bukan sebagai berkas peta yang lenyap.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const peta = readFileSync(
  new URL("../../src/app/(app)/peta/peta-map.tsx", import.meta.url),
  "utf8",
);

describe("pengelompokan penanda", () => {
  it("aturannya satu tempat, dipakai saat sumber dibuat dan saat diubah", () => {
    // Disalin dua kali berarti radius pengelompokan bisa berbeda antara
    // keadaan awal dan sesudah tombol ditekan — penanda "melompat" tanpa sebab.
    expect(peta).toContain("const KELOMPOK_OPSI = (aktif: boolean) => ({");
    expect(peta).toContain("...KELOMPOK_OPSI(true)");
    expect(peta).toContain("setClusterOptions(KELOMPOK_OPSI(kelompok))");
  });

  it("ada tombol untuk mematikannya", () => {
    expect(peta).toContain("setKelompok((v) => !v)");
    expect(peta).toContain("Semua titik");
  });

  it("dimatikan TANPA membangun ulang sumber peta", () => {
    // Membuang lalu menambah sumber berarti seluruh lapisan penanda ikut
    // dibuat ulang — pilihan lokasi dan posisi pandangan hilang di tengah
    // pekerjaan orang.
    const efek =
      /useEffect\(\(\) => \{((?:(?!useEffect)[\s\S])*?)\}, \[kelompok\]\);/.exec(peta)?.[1] ?? "";
    expect(efek, "efek pengalih kelompok tidak ketemu").not.toBe("");
    expect(efek).not.toContain("removeSource");
    expect(efek).not.toContain("addSource");
  });
});

describe("pilihan lapisan yang tinggal satu", () => {
  it("menyebut sumber yang tersisa alih-alih diam", () => {
    expect(peta).toContain("Citra satelit saja – peta dasar belum ada di server ini");
    expect(peta).toContain("Peta dasar saja – citra satelit dimatikan.");
  });
});
