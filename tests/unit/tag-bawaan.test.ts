import { describe, expect, it } from "vitest";
import { nilaiTagBawaan } from "../../src/lib/photo-stamp/tag-bawaan";

/**
 * TAG BAWAAN FOTO — deteksi dari TULISAN yang terbaca di foto (DECISIONS 617).
 *
 * Ketetapan user 2026-09-25: *"kalau sudah ada tag lokasi, maka jangan kasih
 * tag lokasi, kalau sudah ada tanggal jangan beri tag tanggal. jika ada
 * dua2nya ya jangan kasih dua2nya"* — dan letak/format cap dari aplikasi
 * kamera dianggap acak. Yang diuji di sini aturannya; pembacaan OCR-nya diuji
 * terpisah di uji integrasi dengan foto sungguhan.
 */
describe("nilaiTagBawaan – tanggal", () => {
  it.each([
    "25/09/2026 14:32",
    "2026-09-25 07:48:12",
    "Jumat, 25 Sep 2026",
    "25 September 2026 • 16:15 WIB",
    "Sabtu, 25 Juli 2026 • 16:15 WIB",
    "Sep 25, 2026 9:15 AM",
    "25-09-2026",
    "25.09.2026 10:01",
  ])("terbaca sebagai tanggal: %s", (teks) => {
    expect(nilaiTagBawaan(teks).waktu).toBe(true);
  });

  it.each(["14:32", "SEMEN - BESI - CAT", "TITIK DUGA GEOLISTRIK 2", "Tel 0812-3456-7890", "No. 12/2026"])(
    "BUKAN tanggal: %s",
    (teks) => {
      expect(nilaiTagBawaan(teks).waktu).toBe(false);
    },
  );
});

describe("nilaiTagBawaan – lokasi", () => {
  it.each([
    "Lat -6.912345 Long 112.845678",
    "-6.8712, 109.2531",
    "6.871010°S, 109.253123°E",
    "Koordinat: 6.871010°S, 109.253123°E",
    '7°03\'21"S 112°44\'10"E',
    "25 Sep 2026 16:05 -7.051234, 112.736512 Alt 12m",
  ])("koordinat terbaca: %s", (teks) => {
    expect(nilaiTagBawaan(teks).lokasi).toBe(true);
  });

  it("alamat + tanggal = cap lokasi (aplikasi yang tidak menulis koordinat)", () => {
    const h = nilaiTagBawaan("25/09/2026 14:32 | Jl. Raya Klampis, Kec. Klampis | Kab. Bangkalan, Jawa Timur");
    expect(h.lokasi).toBe(true);
    expect(h.waktu).toBe(true);
  });

  it("nama wilayah lokasi itu sendiri + tanggal = cap lokasi", () => {
    const h = nilaiTagBawaan("Jumat, 25 Sep 2026 09:15 | Kranji, Paciran, Lamongan", {
      namaWilayah: ["Kranji", "Paciran", "Lamongan", "Jawa Timur"],
    });
    expect(h.lokasi).toBe(true);
  });

  it("nama wilayah yang salah SATU huruf oleh OCR tetap dikenali", () => {
    const h = nilaiTagBawaan("25 Sep 2026 09:15 | Kra | Lamengan", { namaWilayah: ["Kranji", "Lamongan"] });
    expect(h.lokasi).toBe(true);
  });

  it("kata pendek yang kebetulan mirip nama wilayah tidak lolos", () => {
    const h = nilaiTagBawaan("25 Sep 2026 | Sore hari", { namaWilayah: ["Sora"] });
    expect(h.lokasi).toBe(false);
  });

  it("papan nama berisi kecamatan/kabupaten TANPA tanggal BUKAN cap lokasi", () => {
    // Foto lapangan sungguhan (tests/fixtures/IMG20260801WA0035.jpg): papan
    // "TITIK DUGA GEOLISTRIK – KECAMATAN PACIRAN – KAB/KOTA LAMONGAN".
    const h = nilaiTagBawaan("TITIK DUGA GEOLISTRIK 2 | LOKASI KNMP | KECAMATAN PACIRAN | KAB / KOTA LAMONGAN", {
      namaWilayah: ["Kranji", "Paciran", "Lamongan"],
    });
    expect(h.lokasi).toBe(false);
    expect(h.waktu).toBe(false);
  });

  it("angka desimal di luar wilayah Indonesia bukan koordinat", () => {
    expect(nilaiTagBawaan("Harga 45.500 total 250.750000").lokasi).toBe(false);
    expect(nilaiTagBawaan("Volume 12.345678 m3").lokasi).toBe(false);
  });

  it("tidak ada tulisan → tidak ada yang disembunyikan", () => {
    expect(nilaiTagBawaan("")).toMatchObject({ lokasi: false, waktu: false });
  });

  it("buktinya ikut dikembalikan – keputusan per foto bisa ditelusuri", () => {
    const h = nilaiTagBawaan("25/09/2026 14:32 Lat -6.912345 Long 112.845678");
    expect(h.bukti.waktu).toMatch(/25\/09\/2026/);
    expect(h.bukti.lokasi).toMatch(/6\.912345/);
  });
});
