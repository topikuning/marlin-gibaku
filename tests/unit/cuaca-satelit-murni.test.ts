// CUACA DARI SATELIT – aturan murni (DECISIONS baru 2026-10-07).
//
// Angka acuan geometri Himawari diambil dari berkas NOAA sungguhan
// (AHI-CMSK 2026-10-06 06:00 UTC): piksel (3120, 1167) berkoordinat
// −6,923442 / 109,740311 menurut dataset Latitude/Longitude berkas itu sendiri.
// Susunan grid GSMaP (3600×1200 float32 LE, 59,95°LU turun, bujur 0,05 naik)
// mengikuti pembaca CDT (rijaf-iri/CDT, cdtDownloadRFE_gsmap.R).
import { describe, expect, it } from "vitest";
import {
  AWAN_MENDUNG_PERSEN,
  GSMAP_BITA,
  GSMAP_LEBAR,
  HUJAN_SATELIT_MM,
  hujanDariGrid,
  indeksGsmap,
  jalurGsmap,
  jamSudahLewat,
  jamUtc,
  jarakKm,
  gabungkanJam,
  kategoriSatelit,
  persenAwan,
  pikselHimawari,
  urutkanVersiGsmap,
} from "@/lib/weather/satelit-murni";

describe("geometri Himawari", () => {
  it("titik Batang jatuh di piksel yang koordinatnya dicatat berkas NOAA", () => {
    expect(pikselHimawari(-6.92, 109.73)).toEqual({ baris: 3120, kolom: 1167 });
    expect(jarakKm(-6.92, 109.73, -6.923442, 109.740311)).toBeLessThan(2);
  });

  it("titik tepat di bawah satelit ada di tengah piringan; sisi lain bumi tidak terlihat", () => {
    // Tepat di garis tengah (2750,5 − 1): pembulatan setengah ke atas.
    expect(pikselHimawari(0, 140.7)).toEqual({ baris: 2750, kolom: 2750 });
    expect(pikselHimawari(0, -40)).toBeNull();
  });

  it("seluruh Indonesia terlihat", () => {
    for (const [lat, lng] of [
      [5.9, 95.3],
      [-11, 122],
      [-8.5, 140.9],
      [3.6, 98.7],
    ]) {
      expect(pikselHimawari(lat, lng)).not.toBeNull();
    }
  });
});

describe("persenAwan", () => {
  it("menghitung mungkin-berawan dan berawan sebagai awan, melewati nilai isi", () => {
    expect(persenAwan([[0, 1, 2, 3]])).toBe(50);
    expect(persenAwan([[3, 3, -128, 0]])).toBe(67);
  });

  it("kurang dari separuh piksel sah → tidak bisa disimpulkan", () => {
    expect(persenAwan([[3, -128, -128, -128]])).toBeNull();
    expect(persenAwan([[Number.NaN]])).toBeNull();
  });
});

describe("GSMaP", () => {
  it("indeks kotak: baris dari 60°LU ke selatan, bujur 0–360", () => {
    expect(indeksGsmap(59.95, 0.05)).toEqual({ x: 0, y: 0 });
    expect(indeksGsmap(-6.92, 109.73)).toEqual({ x: 1097, y: 669 });
    expect(indeksGsmap(0, -0.05)).toEqual({ x: 3599, y: 600 });
    expect(indeksGsmap(61, 100)).toBeNull();
  });

  it("membaca float32 little-endian; nilai negatif = tidak ada pengamatan, bukan 0", () => {
    const isi = new Uint8Array(GSMAP_BITA);
    const v = new DataView(isi.buffer);
    v.setFloat32((669 * GSMAP_LEBAR + 1097) * 4, 2.75, true);
    v.setFloat32((669 * GSMAP_LEBAR + 1098) * 4, -99, true);
    expect(hujanDariGrid(isi, -6.92, 109.73)).toBe(2.75);
    expect(hujanDariGrid(isi, -6.92, 109.83)).toBeNull();
    expect(hujanDariGrid(isi, -6.92, 109.93)).toBe(0);
    expect(() => hujanDariGrid(new Uint8Array(10), 0, 0)).toThrow(/seharusnya/);
  });

  it("jalur berkas jam dan urutan versi", () => {
    expect(jalurGsmap("v8", "2026-10-06", 3)).toBe(
      "realtime_ver/v8/hourly_G/2026/10/06/gsmap_gauge.20261006.0300.dat.gz",
    );
    expect(urutkanVersiGsmap(["v6", "v10", "README", "v8", "v7"])).toEqual(["v10", "v8", "v7", "v6"]);
  });
});

describe("kategoriSatelit", () => {
  it("hujan terukur menang atas awan", () => {
    expect(kategoriSatelit(14, 10, 1.2)).toMatchObject({ category: "Hujan", code: 61, precipMm: 1.2, cloudPct: 10 });
    expect(kategoriSatelit(14, null, 6)).toMatchObject({ category: "Hujan", code: 65 });
  });

  it("hujan sangat ringan (di bawah ambang) tidak dihitung hujan", () => {
    expect(kategoriSatelit(9, 80, HUJAN_SATELIT_MM - 0.01)).toMatchObject({ category: "Mendung" });
  });

  it("awan ≥ ambang → Mendung; di bawahnya → Cerah", () => {
    expect(kategoriSatelit(9, AWAN_MENDUNG_PERSEN, 0)).toMatchObject({ category: "Mendung", code: 3 });
    expect(kategoriSatelit(9, AWAN_MENDUNG_PERSEN - 1, 0)).toMatchObject({ category: "Cerah", code: 1 });
    expect(kategoriSatelit(9, 0, 0)).toMatchObject({ category: "Cerah", code: 0, precipMm: 0 });
  });

  it("tanpa data hujan hanya langit nyaris bersih yang boleh disebut Cerah; selebihnya dikosongkan", () => {
    expect(kategoriSatelit(16, 5, null)).toMatchObject({ category: "Cerah" });
    expect(kategoriSatelit(16, 40, null)).toBeNull();
    expect(kategoriSatelit(16, 100, null)).toBeNull();
  });

  it("tanpa data awan dan tanpa hujan → kosong", () => {
    expect(kategoriSatelit(10, null, 0)).toBeNull();
    expect(kategoriSatelit(10, null, null)).toBeNull();
  });
});

describe("waktu", () => {
  it("kolom 07–21 WIB = jam 00–14 UTC di tanggal yang sama", () => {
    expect(jamUtc(7)).toBe(0);
    expect(jamUtc(21)).toBe(14);
  });

  it("jam baru dianggap terjadi sesudah rentangnya selesai", () => {
    const jam1430 = new Date("2026-10-07T14:30:00+07:00");
    expect(jamSudahLewat("2026-10-07", 13, jam1430)).toBe(true);
    expect(jamSudahLewat("2026-10-07", 14, jam1430)).toBe(false);
    expect(jamSudahLewat("2026-10-06", 21, jam1430)).toBe(true);
  });
});

describe("gabungkanJam (pembaruan pukul 04.00, DECISIONS 657)", () => {
  const model = [7, 8, 9].map((hour) => ({ hour, category: "Hujan" as const, precipMm: 2, code: 61 }));

  it("satelit menang di jam yang bisa disimpulkan, model mengisi sisanya, asal tiap jam dicatat", () => {
    const sat = new Map([
      [7, { awan: 0, hujan: 0 }], // langit bersih, tidak hujan → Cerah (satelit)
      [8, { awan: 90, hujan: null }], // berawan, hujan tidak diketahui → model
    ]);
    const g = gabungkanJam(model, sat);
    expect(g.hours.map((h) => [h.hour, h.category, h.sumber])).toEqual([
      [7, "Cerah", "satelit"],
      [8, "Hujan", "model"],
      [9, "Hujan", "model"],
    ]);
    expect(g).toMatchObject({ jamSatelit: 1, jamModel: 2 });
  });

  it("jam tanpa model dan tanpa satelit tetap kosong – tidak dikarang", () => {
    const g = gabungkanJam([], new Map([[10, { awan: null, hujan: null }]]));
    expect(g.hours).toEqual([]);
  });
});
