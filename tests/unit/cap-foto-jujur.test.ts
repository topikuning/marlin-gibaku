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

/* ── 1. Koordinat cadangan harus mengaku ─────────────────────────────────── */

describe("koordinat titik proyek diberi penanda", () => {
  it("tanpa penanda: koordinat tampil polos (memang GPS foto)", () => {
    const svg = buildStampSvg(1200, 900, data(), OPTS);
    expect(svg).toContain("Koordinat: 6.847202°S, 108.878900°E");
    expect(svg).not.toContain("titik proyek");
  });

  it("dengan coordNote: pembaca tahu itu bukan posisi fotonya", () => {
    const svg = buildStampSvg(1200, 900, data({ coordNote: "titik proyek" }), OPTS);
    expect(svg).toContain("Koordinat: 6.847202°S, 108.878900°E");
    expect(svg).toContain("titik proyek");
  });

  it("penanda ikut ter-escape (tidak bisa menyuntik markup ke SVG)", () => {
    const svg = buildStampSvg(1200, 900, data({ coordNote: "<b>x</b>" }), OPTS);
    expect(svg).not.toContain("<b>x</b>");
    expect(svg).toContain("&lt;b&gt;x&lt;/b&gt;");
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

  it("penanda waktu dirender apa adanya, bukan selalu 'waktu unggah'", () => {
    const a = buildStampSvg(1200, 900, data({ timeNote: "jam tidak tercatat" }), OPTS);
    expect(a).toContain("jam tidak tercatat");
    expect(a).not.toContain("waktu unggah");
    const b = buildStampSvg(1200, 900, data({ timeNote: "waktu unggah" }), OPTS);
    expect(b).toContain("waktu unggah");
    const c = buildStampSvg(1200, 900, data(), OPTS);
    expect(c).not.toContain("waktu unggah");
    expect(c).not.toContain("jam tidak tercatat");
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
