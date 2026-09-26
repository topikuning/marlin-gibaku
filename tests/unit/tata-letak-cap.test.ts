// TATA LETAK CAP YANG MENGHINDARI CAP LAMA (DECISIONS 619).
import { describe, expect, it } from "vitest";
import { buildStampSvg } from "@/lib/photo-stamp/renderer";
import {
  adaTulisanDi,
  letakUnsur,
  pilihTataLetak,
  TATA_LETAK_LAMA,
  type UkuranCap,
} from "@/lib/photo-stamp/tata-letak";

const U: UkuranCap = {
  W: 1600,
  H: 900,
  safeX: 50,
  safeY: 27,
  kepalaH: 60,
  jarak: 27,
  info: { w: 700, h: 290 },
  logo: { w: 220, h: 57 },
  panel: { w: 420, h: 60 },
};

describe("pilihTataLetak", () => {
  it("foto tanpa tulisan → tata letak lama, persis", () => {
    expect(pilihTataLetak(U, [])).toEqual(TATA_LETAK_LAMA);
  });

  it("satu kata nyasar kecil tidak memindahkan cap", () => {
    expect(pilihTataLetak(U, [{ x: 0.2, y: 0.8, w: 0.03, h: 0.02 }])).toEqual(TATA_LETAK_LAMA);
  });

  it("cap lama kiri-bawah → blok info pindah ke kanan-bawah", () => {
    const t = pilihTataLetak(U, [
      { x: 0.02, y: 0.76, w: 0.26, h: 0.05 },
      { x: 0.02, y: 0.81, w: 0.24, h: 0.05 },
      { x: 0.02, y: 0.86, w: 0.27, h: 0.05 },
    ]);
    expect(t).toMatchObject({ tegak: "bawah", infoKanan: true });
  });

  it("cap lama selebar foto di bawah → blok info naik ke atas", () => {
    const t = pilihTataLetak(U, [
      { x: 0.01, y: 0.83, w: 0.5, h: 0.05 },
      { x: 0.01, y: 0.88, w: 0.33, h: 0.05 },
    ]);
    expect(t.tegak).not.toBe("bawah");
  });

  it("tulisan lama di kanan-atas → logo dan panel perusahaan menyingkir darinya", () => {
    const kotak = { x: 0.84, y: 0.02, w: 0.14, h: 0.07 };
    const t = pilihTataLetak(U, [kotak]);
    expect(t).not.toEqual(TATA_LETAK_LAMA);
    const l = letakUnsur(U, t);
    const px = { x: kotak.x * U.W, y: kotak.y * U.H, w: kotak.w * U.W, h: kotak.h * U.H };
    const tabrak = (r: { x: number; y: number; w: number; h: number }) =>
      r.x < px.x + px.w && px.x < r.x + r.w && r.y < px.y + px.h && px.y < r.y + r.h;
    expect(tabrak(l.logo)).toBe(false);
    expect(tabrak(l.panel!)).toBe(false);
  });

  it("deretan logo di atas nama BUMN (kanan-atas) → logo DAN panel perusahaan pindah ke kiri berdampingan", () => {
    // Foto user 2026-09-26: logo tidak terbaca OCR; yang terbaca hanya "VIRAMA"
    // kecil dan satu baris nama BUMN di bawah deretan logo. Panel nama
    // perusahaan sempat mendarat di atas logo-logo itu.
    const t = pilihTataLetak(U, [
      { x: 0.93, y: 0.1, w: 0.05, h: 0.03 },
      { x: 0.72, y: 0.13, w: 0.27, h: 0.03 },
    ]);
    const l = letakUnsur(U, t);
    // Pojok kanan-atas (deretan logo sampai tepi atas) bebas dari kepala MARLIN.
    const pojok = { x: 0.66 * U.W, y: 0, w: 0.34 * U.W, h: 0.17 * U.H };
    const tabrak = (r: { x: number; y: number; w: number; h: number }) =>
      r.x < pojok.x + pojok.w && pojok.x < r.x + r.w && r.y < pojok.y + pojok.h && pojok.y < r.y + r.h;
    expect(tabrak(l.logo)).toBe(false);
    expect(tabrak(l.panel!)).toBe(false);
  });

  it("…dan bila bawah foto juga ber-cap, kepala tetap di atas: berdampingan di kiri", () => {
    const t = pilihTataLetak(U, [
      { x: 0.93, y: 0.1, w: 0.05, h: 0.03 },
      { x: 0.72, y: 0.13, w: 0.27, h: 0.03 },
      { x: 0.6, y: 0.84, w: 0.39, h: 0.04 },
      { x: 0.45, y: 0.9, w: 0.54, h: 0.04 },
    ]);
    expect(t).toMatchObject({ logoKiri: true, kepalaRapat: true });
    expect(t.tegak).not.toBe("tukar");
  });

  it("baris lebar dianggap pita penuh (logo di ujung bilah tidak terbaca OCR)", () => {
    expect(adaTulisanDi([{ x: 0.01, y: 0.85, w: 0.45, h: 0.05 }], { x: 1500, y: 700, w: 100, h: 200 }, 1600, 900)).toBe(
      true,
    );
    expect(adaTulisanDi([{ x: 0.01, y: 0.85, w: 0.3, h: 0.05 }], { x: 1500, y: 700, w: 100, h: 200 }, 1600, 900)).toBe(
      false,
    );
  });
});

describe("buildStampSvg dengan tulisan lama", () => {
  const DATA = {
    companyName: "PT UJI",
    locationName: "KNMP Kranji",
    categoryName: "V. PEKERJAAN SHELTER",
    workName: "Pembesian",
    dateTimeText: "Jumat, 25 September 2026 • 09:00 WIB",
    coordinateText: "6.870000°S, 112.370000°E",
    reporterName: "Site Manager",
    photoId: "KRJ-1",
    accentColor: "#F7941D",
    overlayAlpha: 0.9,
    sizeScale: 1,
  };
  const OPTS = { fontFamily: "Uji", fontFaceCss: "" };

  it("tanpa tulisan lama: bayangan selebar foto, tanpa masker", () => {
    const svg = buildStampSvg(1600, 900, DATA, OPTS);
    expect(svg).toContain('<rect x="0" y="594" width="1600" height="306" fill="url(#pg)"/>');
    expect(svg).not.toContain('mask="url(#pmk)"');
  });

  it("cap lama kiri-bawah: teks MARLIN rata kanan, bayangan setempat tidak sampai ke kiri", () => {
    const svg = buildStampSvg(1600, 900, { ...DATA, hindari: [{ x: 0.02, y: 0.78, w: 0.27, h: 0.14 }] }, OPTS);
    expect(svg).toContain('text-anchor="end"');
    const m = svg.match(/<rect x="(\d+)" y="\d+" width="(\d+)" height="\d+" fill="url\(#pg\)" mask="url\(#pmk\)"\/>/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0.29 * 1600);
    expect(Number(m![1]) + Number(m![2])).toBe(1600);
  });
});
