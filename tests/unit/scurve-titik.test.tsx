import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ScurveChart } from "@/components/knmp/scurve-chart";
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
describe("titik realisasi menempel pada garis kurva-S", () => {
  it("titik awal dan minggu terakhir memakai indeks yang sama dengan garis", () => {
    const html = renderToStaticMarkup(<ScurveChart series={{totalWeeks:2,currentWeek:2,planPct:[50,100],actualPct:[25,75]}} />);
    const points = [...html.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
    // Area plot y=12..252: 0%=252, 25%=192, 75%=72; x=40,334,628.
    expect(points).toEqual([[40,252],[334,192],[628,72]]);
    expect(html).not.toContain("NaN");
  });
  it("minggu tanpa realisasi tidak diberi titik nol palsu", () => {
    const html = renderToStaticMarkup(<ScurveChart series={{totalWeeks:2,currentWeek:1,planPct:[50,100],actualPct:[25,null]}} />);
    const points = [...html.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
    expect(points).toEqual([[40,252],[334,192]]);
  });
});

describe("kurva-S paket: garis tiap lokasi (DECISIONS 677)", () => {
  const seri = { totalWeeks: 3, currentWeek: 2, planPct: [10, 50, 100], actualPct: [12, 40, null] };
  const lokasi = [
    { nama: "Pantai Harapan", planPct: [10, 50, 100], actualPct: [20, 60, null] },
    { nama: "Batu Putih", planPct: [10, 50, 100], actualPct: [5, 20, null] },
  ];

  it("tiap lokasi punya garis berwarna tetap dan nama di keterangan", () => {
    const html = renderToStaticMarkup(<ScurveChart series={seri} lokasi={lokasi} />);
    expect(html).toContain('stroke="var(--color-seri-1)"');
    expect(html).toContain('stroke="var(--color-seri-2)"');
    expect(html).toContain("Pantai Harapan (60,0%)");
    expect(html).toContain("Batu Putih (20,0%)");
    expect(html).toContain("Realisasi paket (40,0%)");
    // Garis paket digambar SESUDAH garis lokasi → tetap di atas.
    expect(html.indexOf('stroke="var(--color-primary)"')).toBeGreaterThan(html.indexOf('stroke="var(--color-seri-2)"'));
    expect(html).not.toContain("NaN");
  });

  it("lokasi ke-9 dst. tidak diberi warna karangan", () => {
    const banyak = Array.from({ length: 9 }, (_, i) => ({ nama: `Desa ${i + 1}`, planPct: [10, 50, 100], actualPct: [1, 2, null] }));
    const html = renderToStaticMarkup(<ScurveChart series={seri} lokasi={banyak} />);
    expect(html).toContain('stroke="var(--color-seri-8)"');
    expect(html).not.toContain("--color-seri-9");
    expect(html).toContain('stroke="var(--color-ink-faint)" stroke-width="1.5"');
  });

  it("kurva lokasi biasa tanpa garis lokasi, keterangan tidak memakai kata paket", () => {
    const html = renderToStaticMarkup(<ScurveChart series={seri} />);
    expect(html).not.toContain("--color-seri-");
    expect(html).toContain("Realisasi (40,0%)");
  });
});
