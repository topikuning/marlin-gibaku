// PANDANGAN AWAL PETA = KOTAK LOKASI, BUKAN SELURUH INDONESIA.
//
// Ketetapan lama (DECISIONS 135: *"PetaMap tidak lagi hardcode view Jawa —
// fitBounds otomatis ke seluruh marker"*), ditegaskan ulang user 2026-09-06:
// *"bukankah dulu aku sudah bilang untuk hanya fokus pada yang ada lokasi, jadi
// kamu tidak perlu zoom out satu wilayah indonesia, tapi hanya atas yg ada
// lokasi saja"*.
//
// Kepindahan ke MapLibre mengembalikannya diam-diam: peta dibuat dengan pusat &
// zoom TETAP (se-Indonesia), lalu baru dirapatkan pada event `load`. Bingkai
// pertama yang dilihat orang tetap peta se-Indonesia.
//
// Yang dijaga di sini bentuk regresinya, bukan sekadar adanya `fitBounds`:
// kotaknya harus masuk ke KONSTRUKTOR, sebab di situlah bingkai pertama
// ditentukan.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const peta = readFileSync(
  new URL("../../src/app/(app)/peta/peta-map.tsx", import.meta.url),
  "utf8",
);

/** Isi `new maplibregl.Map({ … })` — tempat bingkai pertama diputuskan. */
const konstruktor = /new maplibregl\.Map\(\{([\s\S]*?)\n {4}\}\);/.exec(peta)?.[1] ?? "";

describe("bingkai awal peta sebaran", () => {
  it("kotak lokasi diberikan langsung ke konstruktor peta", () => {
    expect(konstruktor, "konstruktor Map tidak ketemu").not.toBe("");
    expect(konstruktor).toContain("bounds: batas");
    expect(konstruktor).toContain("fitBoundsOptions");
  });

  it("pusat & zoom tetap HANYA untuk keadaan tanpa lokasi", () => {
    // Kalau `center`/`zoom` berdiri sendiri (bukan di cabang "tidak ada
    // lokasi"), peta kembali membuka se-Indonesia.
    expect(konstruktor).toContain("batas");
    const cabangKosong = /: \{ center: PUSAT_KOSONG, zoom: [\d.]+ \}/.test(konstruktor);
    expect(cabangKosong, "center/zoom tetap harus jadi cabang bila batas null").toBe(true);
  });

  it("aturan merapatkan dipakai bersama – konstruktor dan saat sebaran berubah", () => {
    // Dua tempat merapatkan pandangan; kalau angkanya disalin, keduanya bisa
    // melenceng dan peta "melompat" saat filter diubah.
    expect(peta).toContain("const BINGKAI = { padding: 40, maxZoom: 11 } as const;");
    expect(peta).toContain("fitBoundsOptions: BINGKAI");
    expect(peta).toContain("map.fitBounds(batas, { ...BINGKAI, duration: 600 });");
  });

  it("tidak ada lagi perapatan ganda di event load", () => {
    const load = /map\.on\("load", \(\) => \{([\s\S]*?)\n {4}\}\);/.exec(peta)?.[1] ?? "";
    expect(load).not.toContain("fitBounds");
  });
});
