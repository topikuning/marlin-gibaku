// PINDAH HARI DI LAPORAN HARIAN – sekali klik ke hari sebelum/sesudah.
//
// Keluhan user 2026-10-08: *"tidak ada kontrol navigasi hari ke hari, terlalu
// banyak klik, harus kembali ke list kalender, buka lagi satu-satu. saya butuh
// untuk lihat hari selanjutnya … dalam sekali klik"*.
//
// Yang dijaga di sini aturan tanggalnya: hari sesudah hanya ada bila sudah
// terjadi, dan strip "Hari sekitar" berpusat pada tanggal laporan – dulu ia
// berhenti di tanggal itu, jadi hari berikutnya tidak pernah terlihat.
import { describe, expect, it } from "vitest";
import { geserHari, jendelaHariSekitar, tetanggaHari } from "@/lib/daily-report/hari-sekitar";

describe("geserHari", () => {
  it("melintasi akhir bulan dan akhir tahun", () => {
    expect(geserHari("2026-09-30", 1)).toBe("2026-10-01");
    expect(geserHari("2026-10-01", -1)).toBe("2026-09-30");
    expect(geserHari("2026-12-31", 1)).toBe("2027-01-01");
    expect(geserHari("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("tetanggaHari", () => {
  it("laporan lampau: sebelum dan sesudah sama-sama bisa dibuka", () => {
    expect(tetanggaHari("2026-09-25", "2026-10-08")).toEqual({ sebelum: "2026-09-24", sesudah: "2026-09-26" });
  });

  it("hari ini: besok belum terjadi, jadi tidak ada tombol ke sana", () => {
    expect(tetanggaHari("2026-10-08", "2026-10-08")).toEqual({ sebelum: "2026-10-07", sesudah: null });
  });

  it("kemarin: hari sesudahnya adalah hari ini", () => {
    expect(tetanggaHari("2026-10-07", "2026-10-08").sesudah).toBe("2026-10-08");
  });
});

describe("jendelaHariSekitar", () => {
  it("tiga hari sebelum dan tiga hari sesudah tanggal laporan", () => {
    expect(jendelaHariSekitar("2026-09-25", "2026-10-08")).toEqual({ mulai: "2026-09-22", akhir: "2026-09-28" });
  });

  it("tidak melewati hari ini – jendelanya bergeser ke belakang, tetap tujuh hari", () => {
    expect(jendelaHariSekitar("2026-10-07", "2026-10-08")).toEqual({ mulai: "2026-10-02", akhir: "2026-10-08" });
    expect(jendelaHariSekitar("2026-10-08", "2026-10-08")).toEqual({ mulai: "2026-10-02", akhir: "2026-10-08" });
  });

  it("tanggal yang belum terjadi tetap terlihat di ujung jendela", () => {
    expect(jendelaHariSekitar("2026-10-10", "2026-10-08")).toEqual({ mulai: "2026-10-04", akhir: "2026-10-10" });
  });
});
