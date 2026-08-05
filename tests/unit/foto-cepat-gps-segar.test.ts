// KOORDINAT BASI TIDAK BOLEH MENEMPEL KE FOTO (DECISIONS 256).
//
// Kamera dalam aplikasi mengikuti posisi lewat `watchPosition`. Arusnya bisa
// berhenti (masuk bangunan, sinyal hilang) sementara pelapor terus berjalan dan
// terus memotret — dan nilai terakhir tetap terlihat sah.
//
// Ini persis jebakan `maximumAge: 60000` yang dibuang di DECISIONS 219 ("foto di
// lokasi B membawa titik lokasi A"), hanya lewat pintu lain. Cacatnya senyap:
// fotonya tersimpan rapi, koordinatnya cuma menunjuk tempat yang salah.
import { describe, expect, it } from "vitest";
import { UMUR_GPS_MAKS_MS, posisiJepret } from "@/lib/foto-cepat/gps-segar";

const T = 1_700_000_000_000;
const bacaan = (umurMs: number) => ({ lat: -8.4, lng: 116.0, waktu: T - umurMs });

describe("bacaan yang boleh dipakai", () => {
  it("baru saja diterima → dipakai", () => {
    expect(posisiJepret(bacaan(0), T)).toEqual({ lat: -8.4, lng: 116.0 });
  });

  it("tepat di ambang masih dipakai", () => {
    expect(posisiJepret(bacaan(UMUR_GPS_MAKS_MS), T)).not.toBeNull();
  });
});

describe("bacaan yang DIBUANG", () => {
  it("lewat ambang → null, bukan dipakai dengan catatan kecil", () => {
    // Dipakai-dengan-catatan berarti koordinat salah tetap masuk ke bukti.
    expect(posisiJepret(bacaan(UMUR_GPS_MAKS_MS + 1), T)).toBeNull();
  });

  it("jauh lebih tua (mis. sinyal hilang 2 menit) → null", () => {
    expect(posisiJepret(bacaan(120_000), T)).toBeNull();
  });

  it("belum ada bacaan sama sekali → null", () => {
    expect(posisiJepret(null, T)).toBeNull();
  });

  it("bacaan dari MASA DEPAN → null", () => {
    // Jam perangkat bisa mundur saat sinkronisasi waktu; umur negatif berarti
    // perbandingannya tidak bisa dipercaya, jadi jangan dipercaya.
    expect(posisiJepret(bacaan(-5_000), T)).toBeNull();
  });
});

describe("ambangnya masuk akal untuk kerja lapangan", () => {
  it("cukup pendek supaya orang berjalan tidak membawa posisi lama", () => {
    // Berjalan ±1,4 m/detik: 15 detik ≈ 21 m — masih jauh di dalam satu area
    // kerja, dan jauh di bawah jarak antar-lokasi terdekat (474 m).
    expect(UMUR_GPS_MAKS_MS).toBeLessThanOrEqual(20_000);
    // Tapi tidak sependek galat wajar antar-pembaruan GPS.
    expect(UMUR_GPS_MAKS_MS).toBeGreaterThanOrEqual(5_000);
  });
});
