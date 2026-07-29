import { describe, expect, it } from "vitest";
import { buildStampSvg, type StampRenderData } from "@/lib/photo-stamp/renderer";

/**
 * BADGE NAMA PEKERJAAN TIDAK BOLEH MELUBER.
 *
 * Cacat di lapangan 28 Juli 2026: nama pekerjaan panjang ("PEKERJAAN SONDIR
 * TERMASUK PELAPORAN TERMASUK MOBILISASI ALAT DAN PERSONIL") membuat pill merah
 * melar melewati tepi kanan foto, DAN teksnya ikut terpotong — teks di-anchor di
 * tengah pill, jadi begitu pill lebih lebar dari kanvas titik tengahnya keluar
 * layar dan huruf depan hilang.
 *
 * Dua penjagaan yang diuji di sini:
 *  1. lebar pill dibatasi lebar aman kanvas;
 *  2. teks memakai `textLength` — jaminan KERAS lebarnya, sehingga tidak
 *     bergantung pada metrik font yang dipakai runtime. (Estimasi lama meleset
 *     ~13%: faktor sebenarnya ±0,72 per huruf kapital tebal, bukan 0,63.)
 */

const dasar: Omit<StampRenderData, "categoryName"> = {
  companyName: "PT Kurnia Alam Sentosa",
  locationName: "Kemantren",
  dateTimeText: "Minggu, 26 Juli 2026 • 11:22 WIB",
  coordinateText: "6.871010°S, 109.253123°E",
  reporterName: "Mandor Budi",
  photoId: "KMT-260726-1122-01",
  accentColor: "#E11D2E",
  overlayAlpha: 0.9,
  sizeScale: 1,
};

const render = (categoryName: string | null, w = 1600, h = 900) =>
  buildStampSvg(w, h, { ...dasar, categoryName }, { fontFamily: "sans-serif", fontFaceCss: "" });

/** Ambil rect pill (satu-satunya rect ber-rx besar & berwarna aksen di blok bawah). */
function pill(svg: string): { x: number; w: number } | null {
  const m = [...svg.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)" height="\d+" rx="\d+" fill="#E11D2E"\/>/g)];
  const last = m.at(-1);
  return last ? { x: Number(last[1]), w: Number(last[2]) } : null;
}

function teksBadge(svg: string): { x: number; textLength: number } | null {
  const m = svg.match(/<text x="(\d+)" y="\d+" textLength="(\d+)"/);
  return m ? { x: Number(m[1]), textLength: Number(m[2]) } : null;
}

const PANJANG = "PEKERJAAN SONDIR TERMASUK PELAPORAN TERMASUK MOBILISASI ALAT DAN PERSONIL";

describe("badge nama pekerjaan pada cap foto", () => {
  it("nama SANGAT panjang: pill tetap di dalam kanvas", () => {
    const w = 1600;
    const svg = render(PANJANG, w, 900);
    const p = pill(svg)!;
    expect(p).not.toBeNull();
    expect(p.x, "pill tidak boleh mulai di luar kiri").toBeGreaterThanOrEqual(0);
    expect(p.x + p.w, "tepi kanan pill tidak boleh melewati kanvas").toBeLessThanOrEqual(w);
  });

  it("teks dikunci lebarnya dan berada DI DALAM pill", () => {
    const svg = render(PANJANG);
    const p = pill(svg)!;
    const t = teksBadge(svg)!;
    expect(t, "badge wajib memakai textLength sebagai jaminan keras").not.toBeNull();
    expect(t.x, "teks mulai di dalam pill").toBeGreaterThanOrEqual(p.x);
    expect(t.x + t.textLength, "teks berakhir di dalam pill").toBeLessThanOrEqual(p.x + p.w);
  });

  it("berlaku juga di potret dan pada foto sempit", () => {
    for (const [w, h] of [
      [900, 1600],
      [640, 480],
    ] as const) {
      const svg = render(PANJANG, w, h);
      const p = pill(svg)!;
      const t = teksBadge(svg)!;
      expect(p.x + p.w, `pill melewati kanvas ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(t.x + t.textLength, `teks melewati pill ${w}x${h}`).toBeLessThanOrEqual(p.x + p.w);
    }
  });

  it("nama pendek tidak dipotong", () => {
    const svg = render("PEKERJAAN PERSIAPAN");
    expect(svg).toContain("PEKERJAAN PERSIAPAN");
    expect(svg, "yang pendek tidak boleh kena elipsis").not.toContain("PEKERJAAN PERSIAPA…");
  });

  it("tanpa nama pekerjaan, badge tidak digambar", () => {
    expect(teksBadge(render(null))).toBeNull();
  });
});
