// LOGO RESMI DI CAP FOTO (DECISIONS 223 → 224).
//
// Riwayatnya: logo MARLIN di cap foto pernah DIGAMBAR ULANG dengan tangan
// (wordmark Montserrat + huruf "A" beraksen oranye + baris "PROJECT CONTROL"
// yang tidak pernah ada di logo mana pun), lalu sempat diganti ikon + wordmark
// rakitan sendiri. Sekarang yang dipakai LOCKUP RESMI dari user —
// `public/brand/marlin-lockup-compact-dark.svg` — apa adanya.
//
// Uji ini menjaga tautan itu: kalau berkas resminya berubah dan cap tidak ikut,
// atau sebaliknya cap dirapikan sendiri, uji gagal.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";
import { markSvgInner, lockupSvgInner, BRAND_COLORS } from "@/lib/brand-mark";

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

const FONT_TEKS = "MB";
const svg = (w = 1600, h = 1200, d: StampRenderData = data) =>
  buildStampSvg(w, h, d, { fontFamily: FONT_TEKS, fontFaceCss: "" });

/** Geometri persis seperti di public/brand/marlin-*.svg. */
const PATH_M = "M10 88 L10 24 L28 24 L48 50 L68 24 L86 24 L86 88 L70 88 L70 46 L48 74 L26 46 L26 88 Z";
const PATH_KURVA = "M10 80 C28 80 36 66 48 50 C60 34 70 26 88 18";

const BERKAS = readFileSync("public/brand/marlin-lockup-compact-dark.svg", "utf8");

describe("KASUS INTI: cap foto memakai lockup resmi, bukan gambar tangan", () => {
  it("geometri ikon resmi tertanam di SVG cap", () => {
    const s = svg();
    expect(s).toContain(PATH_M);
    expect(s).toContain(PATH_KURVA);
  });

  it("wordmark + KEDUA baris tagline resmi ikut tercap", () => {
    const s = svg();
    expect(s).toContain(">MARLIN<");
    expect(s).toContain("Monitoring, Analysis, Reporting &amp; Learning");
    expect(s).toContain("for Infrastructure Network");
  });

  it('baris karangan "PROJECT CONTROL" sudah tidak dicap lagi', () => {
    expect(svg()).not.toContain("PROJECT CONTROL");
  });

  it("tata letak lockup sama persis dengan berkas resmi", () => {
    // Angka-angka ini yang membuat lockup TERLIHAT seperti logonya; kalau
    // berkas resmi direvisi lagi, uji ini yang menagih cap ikut direvisi.
    for (const potongan of [
      'transform="translate(70,110) scale(4.1)"',
      'x="1140" y="248"',
      'x="1140" y="405"',
      'x="1140" y="480"',
    ]) {
      expect(BERKAS.replace(/\s+/g, " ")).toContain(potongan);
    }
    const s = lockupSvgInner(0, 0, 1800, "ML", FONT_TEKS).replace(/\s+/g, " ");
    expect(s).toContain('transform="translate(70,110) scale(4.1)"');
    expect(s).toContain('x="1140" y="248"');
    expect(s).toContain('x="1140" y="405"');
    expect(s).toContain('x="1140" y="480"');
  });

  it("warna revisi lockup dipakai apa adanya, bukan diselaraskan ke palet lama", () => {
    const s = lockupSvgInner(0, 0, 900, "ML", FONT_TEKS);
    expect(BERKAS).toContain("#EF2330");
    expect(s).toContain("#EF2330"); // merah revisi, sengaja beda dari BRAND_COLORS.merah
    expect(s).toContain("#94A3B8"); // abu tagline
    expect(BRAND_COLORS.merah).not.toBe("#EF2330");
  });

  it("plat gelap dipertahankan — tanpa itu wordmark putih lenyap di foto siang", () => {
    expect(svg()).toContain(`<rect width="1800" height="640" fill="${BRAND_COLORS.latarGelap}"/>`);
  });
});

describe("dua keluarga font — jebakan subset", () => {
  // Font display cap ("ML") adalah SUBSET: isinya hanya huruf yang dibutuhkan
  // wordmark, tanpa huruf kecil sama sekali. Tagline penuh huruf kecil; kalau
  // ikut dirender dengan "ML" ia keluar sebagai kotak kosong — dan cacat itu
  // baru ketahuan setelah ribuan foto tercap.
  it("wordmark pakai font display, tagline pakai font teks", () => {
    const s = svg();
    expect(s).toMatch(/font-family="ML"[^>]*>MARLIN</);
    expect(s).toMatch(new RegExp(`font-family="${FONT_TEKS}"[^>]*>Monitoring`));
    expect(s).not.toMatch(/font-family="ML"[^>]*>Monitoring/);
  });

  it("berat tagline memakai berat yang MEMANG dibenamkan, bukan 600 dari berkas", () => {
    // Berkas resmi menulis 600, tetapi font teks cap hanya membenamkan 400 &
    // 700. Meminta 600 memaksa peraster mengarang berat sendiri — hasilnya
    // berbeda-beda per mesin. Yang dipilih 700: berat yang ada.
    const s = lockupSvgInner(0, 0, 900, "ML", FONT_TEKS);
    for (const baris of ["Monitoring", "for Infrastructure"]) {
      const tag = new RegExp(`<text[^>]*font-weight="(\\d+)"[^>]*>${baris}`).exec(s);
      expect(tag?.[1], baris).toBe("700");
    }
    expect(BERKAS).toContain('font-weight="400"'); // yang di berkas memang beda
  });
});

describe("lockup tidak menabrak elemen lain", () => {
  const panjang: StampRenderData = {
    ...data,
    companyName: "PT. PEMBANGUNAN PERUMAHAN NUSANTARA SEJAHTERA ABADI (PERSERO) TBK",
  };

  it("panel perusahaan berhenti sebelum lockup, tidak menyelinap di bawahnya", () => {
    for (const [w, h] of [
      [1600, 1200],
      [1080, 1440],
      [960, 1280],
    ]) {
      const s = svg(w, h, panjang);
      const panelW = Number(/<path d="M0 0 H(\d+)/.exec(s)?.[1]);
      const lockupX = Number(/<g transform="translate\((\d+),\d+\) scale\(0\./.exec(s)?.[1]);
      expect(Number.isFinite(panelW), `panel ${w}x${h}`).toBe(true);
      expect(Number.isFinite(lockupX), `lockup ${w}x${h}`).toBe(true);
      expect(panelW, `panel harus berhenti sebelum lockup di ${w}x${h}`).toBeLessThanOrEqual(lockupX);
    }
  });

  it("nama perusahaan yang tidak muat DIPOTONG dengan elipsis, bukan dibiarkan meluber", () => {
    const s = svg(1080, 1440, panjang);
    expect(s).toContain("…");
    expect(s).not.toContain("(PERSERO) TBK");
  });

  it("lockup tidak melewati tepi kanan foto", () => {
    for (const [w, h] of [
      [1600, 1200],
      [1080, 1440],
    ]) {
      const s = svg(w, h, panjang);
      const lockupX = Number(/<g transform="translate\((\d+),\d+\) scale\(0\./.exec(s)?.[1]);
      const lebar = Math.round(Math.max(w, h) * 0.26);
      expect(lockupX + lebar, `${w}x${h}`).toBeLessThanOrEqual(w);
    }
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
  });
});
