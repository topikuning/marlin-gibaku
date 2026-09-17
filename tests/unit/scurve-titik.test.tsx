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
