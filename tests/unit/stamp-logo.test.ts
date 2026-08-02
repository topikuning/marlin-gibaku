// LOGO RESMI DI CAP FOTO (DECISIONS 223).
//
// Sebelum ini logo MARLIN di cap foto DIGAMBAR ULANG dengan tangan: wordmark
// Montserrat + huruf "A" beraksen oranye + baris "PROJECT CONTROL". Itu tiruan
// yang dibuat sebelum berkas logo resminya ada — dan tiruan yang beredar di
// ribuan foto lapangan adalah cara paling pelan merusak identitas.
//
// Sekarang geometrinya diambil dari `lib/brand-mark`, SATU sumber dengan
// `public/brand/marlin-icon.svg`. Uji ini menjaga tautan itu: kalau path resmi
// berubah dan cap tidak ikut, uji gagal.
import { describe, expect, it } from "vitest";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";
import { markSvgInner, BRAND_COLORS } from "@/lib/brand-mark";

const data: StampRenderData = {
  companyName: "CV. Tosan",
  locationName: "Wonorejo",
  categoryName: "V. PEKERJAAN SHELTER",
  workName: "Pembesian Besi Beton D13",
  dateTimeText: "Minggu, 2 Agustus 2026 • 19:03 WIB",
  coordinateText: "7.712345°S, 113.912345°E",
  reporterName: "Mandor 01",
  photoId: "WNR-260802-1903-01",
  accentColor: "#D21F2A",
  overlayAlpha: 0.9,
  sizeScale: 1,
};

const svg = () =>
  buildStampSvg(1600, 1200, data, { fontFamily: "sans-serif", embedFontCss: "" } as never);

/** Path huruf "M" persis seperti di public/brand/marlin-icon.svg. */
const PATH_M = "M10 88 L10 24 L28 24 L48 50 L68 24 L86 24 L86 88 L70 88 L70 46 L48 74 L26 46 L26 88 Z";
const PATH_KURVA = "M10 80 C28 80 36 66 48 50 C60 34 70 26 88 18";

describe("KASUS INTI: cap foto memakai ikon resmi, bukan gambar tangan", () => {
  it("path ikon resmi tertanam di SVG cap", () => {
    const s = svg();
    expect(s).toContain(PATH_M);
    expect(s).toContain(PATH_KURVA);
  });

  it("wordmark MARLIN tetap ada — ikon melengkapi, bukan menggantikan nama", () => {
    expect(svg()).toContain(">MARLIN<");
  });

  it('baris karangan "PROJECT CONTROL" sudah tidak dicap lagi', () => {
    // Itu bukan bagian dari logo resmi; tagline resminya pun sengaja tidak
    // dicap karena terlalu kecil untuk terbaca di foto lapangan.
    expect(svg()).not.toContain("PROJECT CONTROL");
  });
});

describe("varian ikon", () => {
  it("varian putih dipakai di cap — kurvanya ber-outline supaya tidak lenyap di foto terang", () => {
    const s = svg();
    // Varian putih: isi M putih + outline kurva berwarna latar gelap.
    expect(s).toContain(`<path d="${PATH_M}" fill="#FFFFFF"/>`);
    expect(s).toContain(`stroke="${BRAND_COLORS.latarGelap}"`);
  });

  it("varian warna memakai biru & merah resmi", () => {
    const w = markSvgInner(0, 0, 96, "warna");
    expect(w).toContain(BRAND_COLORS.biru);
    expect(w).toContain(BRAND_COLORS.merah);
  });

  it("penskalaan memakai transform, jadi path-nya tidak pernah ditulis ulang", () => {
    // Menulis ulang koordinat per ukuran = dua sumber kebenaran yang pasti
    // menyimpang; skala harus lewat transform.
    expect(markSvgInner(10, 20, 48)).toContain("translate(10,20) scale(0.50000)");
  });
});
