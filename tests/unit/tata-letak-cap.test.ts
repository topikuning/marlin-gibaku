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

  it("cap aplikasi kamera selebar foto di ATAS → kepala DAN blok info turun ke bawah, tidak ada yang menimpa", () => {
    // Foto Botuliodu 2026-09-30 (keluhan user 2026-11-01, DECISIONS 734): lima
    // baris cap kamera di kiri-atas, tiga di antaranya ≥40% lebar foto. Ke-12
    // susunan lama selalu menaruh SESUATU di atas – pilihannya cuma kepala atau
    // blok info yang menimpa, dan yang terpilih blok info (`tukar`).
    const U43: UkuranCap = { ...U, W: 1600, H: 1200, safeY: 36, kepalaH: 81, jarak: 36, info: { w: 470, h: 250 } };
    const kamera = [
      { x: 0.0, y: 0.0, w: 0.32, h: 0.07 },
      { x: 0.0, y: 0.05, w: 0.29, h: 0.06 },
      { x: 0.0, y: 0.09, w: 0.52, h: 0.06 },
      { x: 0.0, y: 0.13, w: 0.57, h: 0.065 },
      { x: 0.0, y: 0.175, w: 0.62, h: 0.07 },
    ];
    const t = pilihTataLetak(U43, kamera);
    const l = letakUnsur(U43, t);
    const atasKamera = 0.25 * U43.H;
    expect(l.info.y).toBeGreaterThan(atasKamera);
    expect(l.logo.y).toBeGreaterThan(atasKamera);
    expect(l.panel!.y).toBeGreaterThan(atasKamera);
    // Blok info di ATAS kepala, keduanya di dalam foto, tidak saling tindih.
    expect(l.info.y + l.info.h).toBeLessThanOrEqual(l.kepalaY);
    expect(l.kepalaY + U43.kepalaH).toBeLessThanOrEqual(U43.H - U43.safeY);
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

  it("cap kamera selebar foto di atas: pill kategori + kepala di bawah, bayangan bawah mencapai pill (DECISIONS 734)", () => {
    const kamera = [
      { x: 0.0, y: 0.0, w: 0.32, h: 0.07 },
      { x: 0.0, y: 0.05, w: 0.29, h: 0.06 },
      { x: 0.0, y: 0.09, w: 0.52, h: 0.06 },
      { x: 0.0, y: 0.13, w: 0.57, h: 0.065 },
      { x: 0.0, y: 0.175, w: 0.62, h: 0.07 },
    ];
    const svg = buildStampSvg(1600, 1200, { ...DATA, locationName: null, coordinateText: null, hindari: kamera }, OPTS);
    // Pill kategori = rect beraksen yang bulat (rx > 1); bilah aksen panel ber-rx 1.
    const pill = [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="\d+" height="\d+" rx="(\d+)" fill="#F7941D"\/>/g)].find(
      (m) => Number(m[2]) > 1,
    );
    expect(pill).toBeDefined();
    const pillY = Number(pill![1]);
    expect(pillY).toBeGreaterThan(0.25 * 1200);
    // Panel perusahaan (kepala) di bawah pill.
    const panel = svg.match(/<rect x="\d+" y="(\d+)" width="\d+" height="\d+" rx="\d+" fill="rgba/);
    expect(panel).not.toBeNull();
    expect(Number(panel![1])).toBeGreaterThan(pillY);
    // Bayangan bawah selebar foto (tak ada tulisan lama di bawah), mulai di atas pill.
    const pita = svg.match(/<rect x="0" y="(\d+)" width="1600" height="(\d+)" fill="url\(#pg\)"\/>/);
    expect(pita).not.toBeNull();
    expect(Number(pita![1])).toBeLessThan(pillY);
    expect(Number(pita![1]) + Number(pita![2])).toBe(1200);
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
