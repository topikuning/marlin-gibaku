/*
 * NIAT `rekap_harian` – "rekap harian seminggu" dikenali TANPA AI (DECISIONS 752).
 *
 * Sebelumnya kalimat ini tidak memuat satu pun kata kunci niat ("rekap" dan
 * "harian" sama-sama kata abaikan, "seminggu" bukan periode), jadi seluruhnya
 * diserahkan ke AI – yang membacanya sebagai laporan MINGGUAN. Padahal yang
 * diminta berkas lain: sampul + laporan harian tiap hari dalam satu minggu.
 */
import { describe, expect, it } from "vitest";
import { frasaSisa, parseNiatDeterministik } from "@/lib/waha/parser-niat";

function niat(teks: string) {
  const h = parseNiatDeterministik(teks);
  return h.jenis === "yakin" ? h.kandidat : null;
}

describe("rekap harian seminggu", () => {
  it.each([
    "rekap harian seminggu",
    "rekap harian",
    "rekap laporan harian seminggu",
    "rekap laporan harian mingguan",
    "laporan harian seminggu",
    "laporan harian sepekan",
    "rekapan harian minggu ini",
  ])("'%s' → rekap_harian", (teks) => {
    expect(niat(teks)?.niat).toBe("rekap_harian");
  });

  it("kata kerja 'kirim' tidak mengubahnya jadi produksi", () => {
    // ARTEFAK memuat "rekap", jadi tanpa pengecualian kalimat ini keluar
    // sebagai `produksi` – dan di chat pribadi itu penolakan.
    expect(niat("kirim rekap harian seminggu kedung mutih")?.niat).toBe("rekap_harian");
    expect(niat("tolong kirimkan rekap laporan harian minggu lalu")?.niat).toBe("rekap_harian");
  });

  it("periodenya tetap terbaca", () => {
    expect(niat("rekap harian minggu lalu")?.periode).toEqual({ jenis: "rentang", satuan: "minggu", mundur: 1 });
    expect(niat("rekap harian seminggu")?.periode).toEqual({ jenis: "hari_ini" });
  });

  it("tidak ada kata yang tersisa selain nama lokasi", () => {
    expect(frasaSisa("rekap harian seminggu")).toEqual([]);
    expect(frasaSisa("kirim rekap harian seminggu kedung mutih")).toEqual(["kedung mutih"]);
    expect(frasaSisa("laporan harian sepekan tengket")).toEqual(["tengket"]);
  });
});

describe("yang lama tidak bergeser", () => {
  it.each([
    ["laporan mingguan", "laporan_mingguan"],
    ["rekap mingguan", "laporan_mingguan"],
    ["laporan hari ini", "laporan"],
    ["laporan harian kemarin", "laporan"],
    ["laporan minggu lalu", "laporan"],
    ["rekap bulanan", "laporan_bulanan"],
    ["kirim laporan mingguan", "produksi"],
  ])("'%s' → %s", (teks, harap) => {
    expect(niat(teks)?.niat).toBe(harap);
  });
});
