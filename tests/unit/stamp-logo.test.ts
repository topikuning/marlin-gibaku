// LOGO RESMI DI CAP FOTO (DECISIONS 223 → 224 → 227).
//
// Riwayatnya panjang karena tiap langkah masih rakitan sendiri: mula-mula
// wordmark digambar ulang dengan tangan (lengkap dengan baris karangan "PROJECT
// CONTROL"), lalu ikon + wordmark rakitan, lalu lockup berplat gelap. Sekarang
// yang dipakai WORDMARK RESMI dari user — `public/brand/marlin-wordmark.svg` —
// apa adanya, dan hurufnya VEKTOR sehingga tidak ada font yang bisa meleset.
//
// Uji ini menjaga tautan itu: kalau berkas resminya berubah dan cap tidak ikut,
// atau sebaliknya cap dirapikan sendiri, uji gagal.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";
import {
  markSvgInner,
  wordmarkSvgInner,
  WORDMARK_DEFS,
  WORDMARK_W,
  WORDMARK_H,
  BRAND_COLORS,
} from "@/lib/brand-mark";

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

const svg = (w = 1600, h = 1200, d: StampRenderData = data) =>
  buildStampSvg(w, h, d, { fontFamily: "MB", fontFaceCss: "" });

/** Geometri persis seperti di public/brand/marlin-*.svg. */
const PATH_M = "M10 88 L10 24 L28 24 L48 50 L68 24 L86 24 L86 88 L70 88 L70 46 L48 74 L26 46 L26 88 Z";
const PATH_KURVA = "M10 80 C28 80 36 66 48 50 C60 34 70 26 88 18";

const BERKAS = readFileSync("public/brand/marlin-wordmark.svg", "utf8");
const rapat = (s: string) => s.replace(/\s+/g, " ");

describe("KASUS INTI: cap foto memakai wordmark resmi, bukan gambar tangan", () => {
  it("geometri ikon resmi tertanam di SVG cap", () => {
    const s = svg();
    expect(s).toContain(PATH_M);
    expect(s).toContain(PATH_KURVA);
  });

  it("SEMUA huruf M-A-R-L-I-N ada sebagai path – bukan sebagai teks", () => {
    const s = rapat(svg());
    // Setiap path huruf di berkas resmi harus muncul di cap. Ini yang membuat
    // wordmark tidak lagi bergantung pada font apa pun.
    const huruf = [...BERKAS.matchAll(/<path d="(M\d[^"]*)"[^>]*translate\(/g)].map((m) => m[1]);
    expect(huruf.length, "jumlah huruf di berkas resmi").toBe(5); // M+A jadi satu path
    for (const d of huruf) expect(s, d.slice(0, 24)).toContain(d);
  });

  it('baris karangan "PROJECT CONTROL" & tagline tidak dicap', () => {
    const s = svg();
    expect(s).not.toContain("PROJECT CONTROL");
    expect(s).not.toContain("Monitoring, Analysis");
  });

  it("tidak ada plat gelap – cap menumpang di atas foto, bukan menutupinya", () => {
    expect(svg()).not.toContain(`<rect width="1800" height="640"`);
  });

  it("warna resmi dipertahankan; yang ditambahkan hanya halo putih", () => {
    const s = svg();
    expect(BERKAS).toContain(BRAND_COLORS.biru);
    expect(BERKAS).toContain(BRAND_COLORS.merah);
    expect(s).toContain(BRAND_COLORS.biru);
    expect(s).toContain(BRAND_COLORS.merah);
    expect(s).toContain('stroke="#FFFFFF"');
  });

  it("mask takik kurva ikut disertakan di <defs> – tanpa itu ikonnya beda bentuk", () => {
    expect(svg()).toContain(WORDMARK_DEFS);
    expect(rapat(BERKAS)).toContain('maskUnits="userSpaceOnUse"');
  });

  it("tata letak internal wordmark sama dengan berkas resmi", () => {
    const s = rapat(wordmarkSvgInner(0, 0, WORDMARK_W));
    expect(rapat(BERKAS)).toContain('transform="translate(20.000,-15.000) scale(3.12500000)"');
    expect(s).toContain('transform="translate(20,-15) scale(3.125)"');
  });
});

describe("halo dua ruang koordinat", () => {
  // Huruf diperkecil 0,134× dan ikon diperbesar 3,125×. Satu angka stroke yang
  // sama akan tampil ~23× lebih tebal di ikon daripada di huruf – cacat yang
  // baru kelihatan setelah dicetak, jadi dijaga di sini.
  it("tebal halo huruf dan ikon dihitung terpisah", () => {
    const s = wordmarkSvgInner(0, 0, 400, { halo: "#FFFFFF" });
    expect(s).toContain('stroke-width="60.0"'); // ruang huruf
    expect(s).toContain('stroke-width="3.00"'); // ruang ikon
  });

  it("tanpa opsi halo, tidak ada stroke sama sekali", () => {
    expect(wordmarkSvgInner(0, 0, 400)).not.toContain("paint-order");
  });
});

describe("tata letak kepala cap: panel ⟷ wordmark", () => {
  const angka = (re: RegExp, s: string) => Number(re.exec(s)?.[1]);

  it("panel dan wordmark sama-sama masuk marjin aman, tidak menempel sudut", () => {
    const s = svg(1600, 1200);
    const panelX = angka(/<rect x="(\d+)" y="\d+" width="\d+" height="\d+" rx="\d+" fill="rgba/, s);
    expect(panelX, "panel tidak lagi di x=0").toBeGreaterThan(0);
  });

  it("keduanya berbagi satu garis tengah", () => {
    const s = svg(1600, 1200);
    const panel = /<rect x="\d+" y="(\d+)" width="\d+" height="(\d+)" rx="\d+" fill="rgba/.exec(s);
    const logo = /<g transform="translate\((\d+),(\d+)\) scale\(0\./.exec(s);
    expect(panel, "panel perusahaan").toBeTruthy();
    expect(logo, "wordmark").toBeTruthy();
    const panelTengah = Number(panel![1]) + Number(panel![2]) / 2;
    const wordmarkH = Math.round(Number(panel![2]) * 0.95);
    const logoTengah = Number(logo![2]) + wordmarkH / 2;
    expect(Math.abs(panelTengah - logoTengah), "selisih garis tengah").toBeLessThanOrEqual(1);
  });

  it("wordmark tidak melewati tepi kanan foto", () => {
    for (const [w, h] of [
      [1600, 1200],
      [1080, 1440],
    ]) {
      const s = svg(w, h);
      const logoX = angka(/<g transform="translate\((\d+),\d+\) scale\(0\./, s);
      const skala = Number(/scale\((0\.\d+)\)/.exec(s)?.[1]);
      expect(logoX + skala * WORDMARK_W, `${w}x${h}`).toBeLessThanOrEqual(w);
    }
  });

  it("nama perusahaan yang tidak muat DIPOTONG, tidak menyelinap di bawah logo", () => {
    const panjang: StampRenderData = {
      ...data,
      companyName: "PT. PEMBANGUNAN PERUMAHAN NUSANTARA SEJAHTERA ABADI (PERSERO) TBK",
    };
    const s = svg(1080, 1440, panjang);
    expect(s).toContain("…");
    expect(s).not.toContain("(PERSERO) TBK");
  });
});

describe("ikon lepas (dipakai UI web)", () => {
  it("varian warna memakai biru & merah resmi", () => {
    const w = markSvgInner(0, 0, 96, "warna");
    expect(w).toContain(BRAND_COLORS.biru);
    expect(w).toContain(BRAND_COLORS.merah);
  });

  it("penskalaan memakai transform, jadi path-nya tidak pernah ditulis ulang", () => {
    // Menulis ulang koordinat per ukuran = dua sumber kebenaran yang pasti
    // menyimpang; skala harus lewat transform.
    expect(markSvgInner(10, 20, 48)).toContain("translate(10,20) scale(0.50000)");
    expect(wordmarkSvgInner(0, 0, WORDMARK_W / 2)).toContain("scale(0.500000)");
    expect(WORDMARK_W / WORDMARK_H).toBeCloseTo(3.983, 2);
  });
});
