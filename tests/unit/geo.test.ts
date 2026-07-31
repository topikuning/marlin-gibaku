import { describe, expect, it } from "vitest";
import { coordinateForDb, parseCoordinatePair } from "@/lib/geo";

/**
 * Sebelum ada file ini tiap form punya rentang sendiri: form tambah lokasi
 * target menerima seluruh bumi (−90..90 / −180..180), form edit membatasi ke
 * Indonesia. Titik mustahil bisa masuk lewat satu pintu lalu ditolak di pintu
 * lain. Aturan tunggal itu dikunci di sini.
 */

describe("parseCoordinatePair", () => {
  it("kosong dua-duanya = lokasi tanpa titik (sah)", () => {
    expect(parseCoordinatePair("", "")).toEqual({ ok: true, lat: null, lng: null });
    expect(parseCoordinatePair(null, undefined)).toEqual({ ok: true, lat: null, lng: null });
  });

  it("setengah koordinat ditolak", () => {
    const a = parseCoordinatePair("-6.871", "");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatch(/bersamaan/i);
    expect(parseCoordinatePair("", "109.253").ok).toBe(false);
  });

  it("titik Indonesia yang wajar diterima", () => {
    expect(parseCoordinatePair("-6.8710100", "109.2531230")).toEqual({
      ok: true,
      lat: -6.87101,
      lng: 109.253123,
    });
  });

  it("koma desimal gaya Indonesia diterima", () => {
    const r = parseCoordinatePair("-6,87101", "109,253123");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lat).toBeCloseTo(-6.87101, 5);
  });

  it("bukan angka ditolak", () => {
    const r = parseCoordinatePair("enam koma delapan", "109");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/angka/i);
  });

  it("lat & lng TERTUKAR dikenali dan disarankan pembetulannya", () => {
    // Pemalang: lat -6.87, lng 109.25 — ditulis terbalik.
    const r = parseCoordinatePair("109.253123", "-6.87101");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/tertukar/i);
      expect(r.error).toContain("-6.87101");
      expect(r.error).toContain("109.253123");
    }
  });

  it("di luar wilayah Indonesia ditolak (kasus salah tanda → Samudra Atlantik)", () => {
    const r = parseCoordinatePair("-6.87101", "-109.253123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Longitude/);
  });

  it("latitude di luar rentang menyebut arah selatan khatulistiwa", () => {
    const r = parseCoordinatePair("48.85", "2.35"); // Paris
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Latitude/);
  });

  it("batas persis diterima (Sabang & Merauke)", () => {
    expect(parseCoordinatePair("6.5", "95").ok).toBe(true);
    expect(parseCoordinatePair("-11", "141.5").ok).toBe(true);
  });
});

describe("coordinateForDb", () => {
  it("null tetap null; angka jadi 7 desimal sesuai Decimal(10,7)", () => {
    expect(coordinateForDb(null)).toBeNull();
    expect(coordinateForDb(-6.87101)).toBe("-6.8710100");
    expect(coordinateForDb(109.253123)).toBe("109.2531230");
  });
});
