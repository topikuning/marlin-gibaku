import { describe, expect, it } from "vitest";
import {
  KELAS_LAYAR,
  WARNA_CAP,
  WARNA_PDF,
  tandaKoordinat,
  tandaWaktu,
  type TandaNilai,
} from "@/lib/photo-stamp/tanda-nilai";

/**
 * ASAL NILAI DITANDAI WARNA, TIDAK DITULIS.
 *
 * Ketetapan user 2026-09-04: *"hilangkan informasi jam tidak tercatat, titik
 * proyek, dan lain sebagainya … cukup mainkan warna pada informasinya"*.
 *
 * Uji ini menjaga DUA sisi sekaligus, dan keduanya perlu:
 *   1. penggolongannya tetap benar — cadangan tetap cadangan, manual tetap
 *      manual (isi DECISIONS 197 tidak ikut dicabut, hanya bentuknya);
 *   2. tiap golongan punya warna yang BERBEDA — warna kembar sama saja dengan
 *      tanda yang hilang, dan itu justru yang dilarang 197.
 */

const SEMUA: TandaNilai[] = ["asli", "cadangan", "manual", "unggah"];

describe("penggolongan asal nilai", () => {
  it("koordinat titik proyek = cadangan, bukan bacaan alat", () => {
    expect(tandaKoordinat("project")).toBe("cadangan");
  });

  it("koordinat diketik orang = manual", () => {
    expect(tandaKoordinat("manual")).toBe("manual");
  });

  it("GPS perangkat pada foto KAMERA asli; pada foto GALERI = posisi saat unggah", () => {
    expect(tandaKoordinat("device")).toBe("asli");
    expect(tandaKoordinat("device", true)).toBe("unggah");
  });

  it("EXIF menempel pada berkasnya sendiri – asli, dari mana pun foto dipilih", () => {
    expect(tandaKoordinat("exif")).toBe("asli");
    expect(tandaKoordinat("exif", true)).toBe("asli");
  });

  it("jam yang tidak diketahui digolongkan cadangan, bukan asli", () => {
    expect(tandaWaktu({ jamDiketahui: false, timeSource: "server" })).toBe("cadangan");
    expect(tandaWaktu({ jamDiketahui: true, timeSource: "server" })).toBe("unggah");
    expect(tandaWaktu({ jamDiketahui: true, timeSource: "manual" })).toBe("manual");
    expect(tandaWaktu({ jamDiketahui: true, timeSource: "exif" })).toBe("asli");
  });
});

describe("warna penanda", () => {
  it("keempat golongan berbeda di cap, di PDF, dan di layar", () => {
    for (const peta of [WARNA_CAP, WARNA_PDF, KELAS_LAYAR]) {
      expect(new Set(SEMUA.map((t) => peta[t])).size).toBe(4);
    }
  });

  it("golongan `asli` tidak mencolok – cap normal tidak boleh terlihat ditandai", () => {
    expect(WARNA_CAP.asli).toBe("#FFFFFF");
  });

  it("daftar warna lengkap untuk setiap golongan – tidak ada yang jatuh ke undefined", () => {
    for (const t of SEMUA) {
      expect(WARNA_CAP[t]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(WARNA_PDF[t]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(KELAS_LAYAR[t]).toMatch(/^bg-/);
    }
  });
});
