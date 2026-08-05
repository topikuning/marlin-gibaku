// PEMILIHAN LOKASI FOTO CEPAT (DECISIONS 253).
//
// Foto Cepat harus bisa dipakai sambil berdiri di lokasi, sering satu tangan.
// Karena itu daftar lokasinya diurutkan dari yang terdekat — tapi urutannya
// saja tidak cukup: yang menentukan foto masuk ke lokasi yang BENAR adalah
// apakah pelapor bisa MENILAI tebakan itu. Karena itu jaraknya ditulis.
//
// Cacat di sini tidak menerbitkan galat apa pun: fotonya tetap tersimpan, cuma
// menempel ke lokasi yang salah — dan baru ketahuan berminggu-minggu kemudian
// saat laporan KKP disusun.
import { describe, expect, it } from "vitest";
import { jarakMeter, labelJarak, urutkanTerdekat } from "@/lib/foto-cepat/jarak";

const LOKASI = [
  { id: "jauh", name: "Desa Jauh", lat: -8.9, lng: 116.5 },
  { id: "dekat", name: "Desa Dekat", lat: -8.5, lng: 116.1 },
  { id: "buta", name: "Desa Tanpa Titik", lat: null, lng: null },
];

describe("jarakMeter", () => {
  it("titik yang sama = 0", () => {
    expect(jarakMeter(-8.5, 116.1, -8.5, 116.1)).toBe(0);
  });

  it("1 derajat lintang ≈ 111 km", () => {
    // Patokan yang bisa diperiksa tanpa alat: jarak antar-lintang praktis tetap.
    const m = jarakMeter(0, 0, 1, 0);
    expect(m).toBeGreaterThan(110_000);
    expect(m).toBeLessThan(112_000);
  });

  it("simetris — urutan argumen tidak mengubah hasil", () => {
    expect(jarakMeter(-8.5, 116.1, -8.9, 116.5)).toBeCloseTo(
      jarakMeter(-8.9, 116.5, -8.5, 116.1),
      6,
    );
  });
});

describe("labelJarak", () => {
  it("di bawah 1 km ditulis meter — itu rentang yang menentukan di lapangan", () => {
    // "0,1 km" tidak memberi tahu apa pun soal "sudah sampai atau belum";
    // "80 m" memberi tahu.
    expect(labelJarak(80)).toBe("80 m");
    expect(labelJarak(999)).toBe("999 m");
  });

  it("1 km ke atas ditulis km", () => {
    expect(labelJarak(1500)).toBe("1.5 km");
    expect(labelJarak(48_000)).toBe("48 km");
  });
});

describe("urutkanTerdekat", () => {
  const posisi = { lat: -8.5, lng: 116.1 };

  it("yang terdekat naik ke atas", () => {
    const hasil = urutkanTerdekat(LOKASI, posisi);
    expect(hasil[0].id).toBe("dekat");
    expect(hasil[0].jarakMeter).toBe(0);
  });

  it("lokasi TANPA titik proyek tidak dibuang, hanya turun", () => {
    // Membuangnya berarti lokasi yang koordinatnya belum diisi mendadak tidak
    // bisa dipakai memotret — dan sebabnya tak akan pernah terlihat dari
    // lapangan, karena yang tampak hanyalah "lokasinya tidak ada di daftar".
    const hasil = urutkanTerdekat(LOKASI, posisi);
    expect(hasil).toHaveLength(3);
    expect(hasil.at(-1)!.id).toBe("buta");
    expect(hasil.at(-1)!.jarakMeter).toBeNull();
  });

  it("tanpa posisi: urutan masukan dipertahankan, jarak null semua", () => {
    // Halaman dirender di server sebelum GPS terbaca. Mengarang urutan
    // "terdekat" saat posisinya belum diketahui berarti menampilkan tebakan
    // sebagai fakta.
    const hasil = urutkanTerdekat(LOKASI, null);
    expect(hasil.map((l) => l.id)).toEqual(["jauh", "dekat", "buta"]);
    expect(hasil.every((l) => l.jarakMeter === null)).toBe(true);
  });

  it("tidak merusak masukannya", () => {
    const salinan = LOKASI.map((l) => ({ ...l }));
    urutkanTerdekat(LOKASI, posisi);
    expect(LOKASI).toEqual(salinan);
  });
});
