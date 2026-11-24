// KOORDINAT LOKASI DIAMBIL DARI GPS HP (DECISIONS 772).
//
// Permintaan user 2026-11-24, sedang di lapangan: *"ada beberapa lokasi tidak
// sesuai koordinatnya. aku mau ada fitur yg aku bisa update koordinat itu kamu
// ambil langsung dari koordinat hp"*.
//
// GPS HP tidak selalu tepat: di tempat terbuka ±5–15 m, di dalam bangunan atau
// sebelum sinyal satelit terkunci bisa ±500 m ke atas (titik dari menara
// seluler). Titik selemah itu tidak boleh menimpa koordinat proyek.
import { describe, expect, it } from "vitest";
import { AKURASI_BAIK_M, AKURASI_TOLAK_M, jarakMeter, mutuAkurasi } from "@/lib/geo";

describe("jarakMeter (haversine)", () => {
  it("titik yang sama = 0", () => {
    expect(jarakMeter({ lat: -6.87, lng: 109.25 }, { lat: -6.87, lng: 109.25 })).toBe(0);
  });

  it("0,001° lintang ≈ 111 m", () => {
    const m = jarakMeter({ lat: -6.87, lng: 109.25 }, { lat: -6.871, lng: 109.25 });
    expect(m).toBeGreaterThan(110);
    expect(m).toBeLessThan(112);
  });

  it("Jepara → Demak ≈ 34 km (urutan besaran benar)", () => {
    const km = jarakMeter({ lat: -6.5886, lng: 110.6684 }, { lat: -6.8909, lng: 110.6396 }) / 1000;
    expect(km).toBeGreaterThan(30);
    expect(km).toBeLessThan(40);
  });
});

describe("mutuAkurasi: kapan titik HP boleh dipakai", () => {
  it("±30 m ke bawah baik", () => {
    expect(AKURASI_BAIK_M).toBe(30);
    expect(mutuAkurasi(8)).toBe("baik");
    expect(mutuAkurasi(30)).toBe("baik");
  });

  it("di atas 30 sampai 100 m dipakai dengan peringatan", () => {
    expect(mutuAkurasi(31)).toBe("sedang");
    expect(mutuAkurasi(100)).toBe("sedang");
  });

  it("di atas 100 m ditolak (titik menara seluler, belum terkunci satelit)", () => {
    expect(AKURASI_TOLAK_M).toBe(100);
    expect(mutuAkurasi(101)).toBe("lemah");
    expect(mutuAkurasi(1500)).toBe("lemah");
  });
});
