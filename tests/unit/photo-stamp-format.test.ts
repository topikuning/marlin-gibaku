import { describe, it, expect } from "vitest";
import {
  formatStampDateTime,
  formatCoordinate,
  getContrastText,
  generatePhotoId,
  locationCodeFromName,
  normalizeHex,
  relativeLuminance,
  jamTakDiketahui,
} from "@/lib/photo-stamp/format";

const SABTU = new Date("2026-07-25T16:15:00+07:00"); // Sabtu 25 Juli 2026, 16:15 WIB

describe("formatStampDateTime", () => {
  it("nama hari & bulan LENGKAP Bahasa Indonesia + WIB", () => {
    expect(formatStampDateTime(SABTU, "Asia/Jakarta")).toBe("Sabtu, 25 Juli 2026 • 16:15 WIB");
  });
  it("mengikuti timezone lokasi (WITA = +1 jam)", () => {
    expect(formatStampDateTime(SABTU, "Asia/Makassar")).toBe("Sabtu, 25 Juli 2026 • 17:15 WITA");
  });
  it("WIT = +2 jam", () => {
    expect(formatStampDateTime(SABTU, "Asia/Jayapura")).toBe("Sabtu, 25 Juli 2026 • 18:15 WIT");
  });
  it("tidak menyingkat (bukan 'Sab'/'Jul')", () => {
    const s = formatStampDateTime(SABTU);
    expect(s).not.toContain("Sab,");
    expect(s).not.toContain("Jul ");
  });
});

describe("formatCoordinate", () => {
  it("6 desimal + arah mata angin", () => {
    expect(formatCoordinate(-6.87101, 109.253123)).toBe("6.871010°S, 109.253123°E");
  });
  it("belahan utara/barat", () => {
    expect(formatCoordinate(1.5, -100.25)).toBe("1.500000°N, 100.250000°W");
  });
  it("null bila salah satu kosong", () => {
    expect(formatCoordinate(null, 1)).toBeNull();
    expect(formatCoordinate(1, null)).toBeNull();
  });
});

describe("getContrastText (WCAG)", () => {
  it("aksen gelap → teks putih", () => {
    expect(getContrastText("#1E3A8A")).toBe("#FFFFFF"); // navy
    expect(getContrastText("#07182D")).toBe("#FFFFFF");
  });
  it("aksen terang → teks gelap", () => {
    expect(getContrastText("#FFFF00")).toBe("#07182D"); // kuning
    expect(getContrastText("#FFFFFF")).toBe("#07182D");
    expect(getContrastText("#22C55E")).toBe("#07182D"); // hijau terang
  });
  it("hasil selalu salah satu dari dua warana valid", () => {
    for (const c of ["#FF8A00", "#8B5CF6", "#EF4444", "#3B82F6"]) {
      expect(["#FFFFFF", "#07182D"]).toContain(getContrastText(c));
    }
  });
});

describe("relativeLuminance", () => {
  it("hitam 0, putih 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("normalizeHex", () => {
  it("normalisasi & validasi", () => {
    expect(normalizeHex("ff8a00")).toBe("#FF8A00");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("bukan-hex")).toBeNull();
  });
});

describe("generatePhotoId", () => {
  it("format <KODE>-<YYMMDD>-<HHMM>-<URUT>", () => {
    const id = generatePhotoId("PHB", new Date("2026-07-26T16:15:00+07:00"), 3, "Asia/Jakarta");
    expect(id).toBe("PHB-260726-1615-003");
  });
  it("urut di-pad 3 digit", () => {
    expect(generatePhotoId("ABC", SABTU, 42)).toMatch(/-042$/);
  });
});

describe("locationCodeFromName", () => {
  it("3 huruf pertama uppercase", () => {
    expect(locationCodeFromName("Purwahamba")).toBe("PUR");
    expect(locationCodeFromName("KNMP Tengket")).toBe("KNM");
    expect(locationCodeFromName("")).toBe("LOK");
  });
});

// JAM YANG TIDAK DIKETAHUI TIDAK BOLEH DICETAK SEBAGAI JAM (DECISIONS 197).
//
// Pertanyaan user 2026-08-07 atas PDF ringkas menampilkan "4 Agt 2026 07.00".
// Angka itu bukan data: kolom tanggal kerja bertipe DATE = tengah malam UTC,
// yang diformat lengkap berbunyi 07.00 WIB.
describe("jamTakDiketahui", () => {
  it("waktu dari tanggal kerja (tengah malam UTC + sumber server) → tidak diketahui", () => {
    expect(jamTakDiketahui("server", new Date("2026-08-04T00:00:00.000Z"))).toBe(true);
  });

  it("waktu unggah sungguhan TIDAK ikut ditandai", () => {
    // Batas yang penting: menandainya juga akan menyembunyikan jam yang SAH.
    expect(jamTakDiketahui("server", new Date("2026-08-04T04:37:12.345Z"))).toBe(false);
  });

  it("EXIF & nama berkas selalu dianggap diketahui", () => {
    expect(jamTakDiketahui("exif", new Date("2026-08-04T00:00:00.000Z"))).toBe(false);
    expect(jamTakDiketahui("filename", new Date("2026-08-04T00:00:00.000Z"))).toBe(false);
  });

  it("tanpa waktu → bukan urusannya", () => {
    expect(jamTakDiketahui("server", null)).toBe(false);
  });
});
