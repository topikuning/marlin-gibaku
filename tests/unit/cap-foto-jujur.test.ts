// Cap foto tidak boleh menyatakan sesuatu yang bukan data foto itu (DECISIONS 197).
//
// Tiga keluhan user 2026-08-01 atas SATU foto Pengaradan:
//   1. footer galeri berbunyi "GPS ✓" padahal koordinat yang tercap adalah
//      titik proyek dari database;
//   2. jamnya "07:00 WIB" — hampir selalu, di hampir semua foto;
//   3. berkas asli tanpa cap katanya disimpan, tapi tak ada tempat mengeceknya.
//
// (2) sebabnya paling halus: tanggal kerja disimpan sebagai kolom DATE, jadi
// Prisma mengembalikannya sebagai tengah malam UTC — yang diformat ke
// Asia/Jakarta menjadi tepat 07:00. Jamnya bukan data, itu offset zona waktu.
import { describe, expect, it } from "vitest";
import { formatStampDate, formatStampDateTime } from "@/lib/photo-stamp/format";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";
import { WARNA_CAP } from "@/lib/photo-stamp/tanda-nilai";
import { originalExt } from "@/lib/photo-file";

const OPTS = { fontFamily: "X", fontFaceCss: "" };

function data(over: Partial<StampRenderData> = {}): StampRenderData {
  return {
    companyName: "CV. Alkomber Karya",
    locationName: "Pengaradan",
    categoryName: "Lainnya",
    dateTimeText: "Jumat, 31 Juli 2026 • 07:00 WIB",
    coordinateText: "6.847202°S, 108.878900°E",
    reporterName: "Prio Yulianto",
    photoId: "PEN-260731-0700-006",
    accentColor: "#F59E0B",
    overlayAlpha: 0.9,
    sizeScale: 1,
    ...over,
  };
}

/* ── 1. Koordinat cadangan ditandai WARNA, tanpa menyebutkannya ──────────── */

/*
 * Ketetapan user 2026-09-04: *"hilangkan informasi jam tidak tercatat, titik
 * proyek, dan lain sebagainya … cukup mainkan warna pada informasinya"*.
 *
 * Larangan DECISIONS 197 TIDAK dicabut — nilai yang bukan bacaan alat tetap
 * wajib ditandai; yang berubah cara menandainya. Karena itu dua hal diuji
 * bersama, dan keduanya perlu: katanya HILANG, warnanya ADA. Menguji satu saja
 * membuat "tanda hilang sama sekali" lolos.
 */
describe("koordinat titik proyek: warna, bukan tulisan", () => {
  it("koordinat asli tampil putih biasa – cap normal tidak terlihat ditandai", () => {
    const svg = buildStampSvg(1200, 900, data(), OPTS);
    expect(svg).toContain("Koordinat: 6.847202°S, 108.878900°E");
    expect(svg).toContain(`fill="${WARNA_CAP.asli}">Koordinat:`);
  });

  it("koordinat cadangan: kata 'titik proyek' TIDAK ditulis, warnanya yang berbeda", () => {
    const svg = buildStampSvg(1200, 900, data({ coordTanda: "cadangan" }), OPTS);
    expect(svg).toContain("Koordinat: 6.847202°S, 108.878900°E");
    expect(svg).not.toContain("titik proyek");
    expect(svg).toContain(`fill="${WARNA_CAP.cadangan}">Koordinat:`);
  });

  it("koordinat diisi manual & posisi saat unggah punya warna sendiri-sendiri", () => {
    const manual = buildStampSvg(1200, 900, data({ coordTanda: "manual" }), OPTS);
    expect(manual).toContain(`fill="${WARNA_CAP.manual}">Koordinat:`);
    expect(manual).not.toMatch(/diisi manual/i);
    const unggah = buildStampSvg(1200, 900, data({ coordTanda: "unggah" }), OPTS);
    expect(unggah).toContain(`fill="${WARNA_CAP.unggah}">Koordinat:`);
    expect(unggah).not.toMatch(/unggah/i);
    // Empat golongan harus benar-benar berbeda; warna kembar = tanda yang hilang.
    expect(new Set(Object.values(WARNA_CAP)).size).toBe(4);
  });
});

/* ── 2. Jam yang tidak diketahui tidak boleh dikarang ────────────────────── */

describe("jam 07:00 yang selalu muncul", () => {
  // Persis nilai yang dikembalikan Prisma untuk kolom @db.Date.
  const tanggalKerja = new Date("2026-07-31T00:00:00.000Z");

  it("BUKTI SEBAB: DATE tengah malam UTC diformat WIB → 07:00", () => {
    expect(formatStampDateTime(tanggalKerja)).toBe("Jumat, 31 Juli 2026 • 07:00 WIB");
  });

  it("formatStampDate membuang jam karangan itu, tanggalnya tetap benar", () => {
    expect(formatStampDate(tanggalKerja)).toBe("Jumat, 31 Juli 2026");
    expect(formatStampDate(tanggalKerja)).not.toContain("07:00");
    expect(formatStampDate(tanggalKerja)).not.toContain("WIB");
  });

  it("jam asli jepret tetap tampil lengkap – aturan ini tidak menggeneralisir", () => {
    const jepret = new Date("2026-07-31T09:15:00.000+07:00");
    expect(formatStampDateTime(jepret)).toBe("Jumat, 31 Juli 2026 • 09:15 WIB");
  });

  it("asal waktu ditandai warna; kata 'jam tidak tercatat' / 'waktu unggah' tidak ditulis", () => {
    const a = buildStampSvg(1200, 900, data({ timeTanda: "cadangan" }), OPTS);
    expect(a).not.toContain("jam tidak tercatat");
    expect(a).toContain(`fill="${WARNA_CAP.cadangan}">Jumat, 31 Juli 2026`);
    const b = buildStampSvg(1200, 900, data({ timeTanda: "unggah" }), OPTS);
    expect(b).not.toContain("waktu unggah");
    expect(b).toContain(`fill="${WARNA_CAP.unggah}">Jumat, 31 Juli 2026`);
    const c = buildStampSvg(1200, 900, data(), OPTS);
    expect(c).toContain(`fill="${WARNA_CAP.asli}">Jumat, 31 Juli 2026`);
  });
});

/* ── 3. Arsip berkas asli ────────────────────────────────────────────────── */

describe("nama berkas arsip asli", () => {
  it("ikut ekstensi nama unggahan (huruf kecil)", () => {
    expect(originalExt("IMG_0042.JPEG", "image/jpeg")).toBe(".jpeg");
    expect(originalExt("foto.HEIC", "image/heic")).toBe(".heic");
  });
  it("tanpa ekstensi → jatuh ke MIME", () => {
    expect(originalExt("blob", "image/png")).toBe(".png");
    expect(originalExt("blob", "image/webp")).toBe(".webp");
  });
  it("keduanya tak dikenal → .bin (byte tetap utuh)", () => {
    expect(originalExt("blob", "application/octet-stream")).toBe(".bin");
  });
});
