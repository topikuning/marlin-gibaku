/*
 * CAP FOTO TIDAK MEMOTONG TEKS YANG MUAT (DECISIONS 644).
 *
 * Keluhan user 2026-10-01 (foto Tegalsari): "CV. Putera…" dan "Pekerjaan beton
 * semi mekanis setara…" terpotong padahal di sebelahnya masih ada ruang kosong.
 * Lebar teks dulu ditaksir dengan faktor huruf KAPITAL (0,72–0,75 per huruf)
 * untuk teks berhuruf kecil (±0,58–0,61) – kelebihan ±24%.
 */
import { describe, expect, it } from "vitest";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";

const data: StampRenderData = {
  companyName: "CV. Putera Fahlevi",
  locationName: "Tegalsari",
  categoryName: "IV. PEKERJAAN DINDING PENAHAN TANAH",
  workName: "Pekerjaan beton semi mekanis setara K-250 untuk sloof dan kolom praktis",
  dateTimeText: "Selasa, 1 September 2026",
  coordinateText: "6.849471°S, 109.123925°E",
  reporterName: "Prio Yulianto",
  photoId: "TEG-260901-0700-004",
  accentColor: "#D21F2A",
  overlayAlpha: 0.9,
  sizeScale: 1,
};
const svg = (w: number, h: number, sizeScale = 1) =>
  buildStampSvg(w, h, { ...data, sizeScale }, { fontFamily: "MB", fontFaceCss: "" });
const teks = (s: string) => [...s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe("teks cap utuh bila muat", () => {
  for (const [w, h, s] of [
    [400, 533, 1],
    [480, 640, 1],
    [600, 800, 1],
    [720, 960, 1],
    [720, 960, 1.15],
    [1080, 1440, 1.15],
    [1600, 1200, 1],
  ] as const) {
    it(`${w}×${h} skala ${s}: nama perusahaan utuh`, () => {
      expect(teks(svg(w, h, s))).toContain("CV. Putera Fahlevi");
    });
    it(`${w}×${h} skala ${s}: nama pekerjaan tampil lengkap (boleh dua baris), tanpa elipsis`, () => {
      const t = teks(svg(w, h, s));
      const gabung = t.filter((x) => x.startsWith("Pekerjaan beton") || x.includes("kolom praktis")).join(" ");
      expect(gabung).toContain("kolom praktis");
      expect(gabung).not.toContain("…");
    });
  }
});
