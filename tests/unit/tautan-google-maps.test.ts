/*
 * TAUTAN "BUKA DI GOOGLE MAPS" UNTUK LOKASI (DECISIONS 749).
 *
 * Permintaan user 2026-11-07: *"lokasi punya koordinat, tapi tidak satupun ada
 * tombol atau link yang sekali klik bisa membuka google map … aku ingin ada
 * tombol untuk buka google map ke/di lokasi itu"*.
 *
 * Yang dijaga di sini: tautan hanya dibuat dari koordinat yang MASUK AKAL.
 * Tombol yang membuka Google Maps di Teluk Guinea (0,0) atau di titik yang
 * mustahil lebih buruk daripada tidak ada tombol – orang lapangan akan
 * mengikutinya.
 */
import { describe, expect, it } from "vitest";
import { tautanGoogleMaps } from "@/lib/peta/google-maps";

describe("tautanGoogleMaps", () => {
  it("memakai URL resmi Maps (search?api=1) – terbuka di aplikasi Maps di ponsel", () => {
    expect(tautanGoogleMaps(0.529617, 124.480295)).toBe(
      "https://www.google.com/maps/search/?api=1&query=0.529617%2C124.480295",
    );
  });

  it("menerima teks dari kolom Decimal apa adanya", () => {
    expect(tautanGoogleMaps("-6.7180000", "110.6390000")).toBe(
      "https://www.google.com/maps/search/?api=1&query=-6.718%2C110.639",
    );
  });

  it("tanpa koordinat → tidak ada tautan", () => {
    expect(tautanGoogleMaps(null, 110)).toBeNull();
    expect(tautanGoogleMaps(-6, undefined)).toBeNull();
    expect(tautanGoogleMaps("", "")).toBeNull();
    expect(tautanGoogleMaps("abc", "110")).toBeNull();
  });

  it("titik 0,0 dianggap belum diisi, bukan lokasi", () => {
    expect(tautanGoogleMaps(0, 0)).toBeNull();
    expect(tautanGoogleMaps("0", "0.0000000")).toBeNull();
  });

  it("di luar rentang bumi → tidak ada tautan", () => {
    expect(tautanGoogleMaps(91, 110)).toBeNull();
    expect(tautanGoogleMaps(-6, 181)).toBeNull();
    expect(tautanGoogleMaps(Number.NaN, 110)).toBeNull();
    expect(tautanGoogleMaps(Number.POSITIVE_INFINITY, 110)).toBeNull();
  });
});
