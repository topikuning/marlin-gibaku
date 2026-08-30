import { describe, expect, it } from "vitest";
import {
  bandingkanDenganNilaiProyek,
  hitungBiaya,
  type HargaSatuan,
  type Kebutuhan,
} from "@/lib/ahsp/rapl-calc";

/**
 * Biaya RAPL + potensi margin terhadap nilai RAB aktif lokasi.
 *
 * Di sinilah RAPL pertama kali menghasilkan ANGKA UANG yang dipakai orang
 * menawar. Yang diuji bukan perkaliannya — itu sepele — melainkan cara ia
 * menolak berbohong saat datanya belum lengkap.
 */

const k = (over: Partial<Kebutuhan> = {}): Kebutuhan => ({
  kategori: over.kategori ?? "bahan",
  nama: over.nama ?? "Semen PC",
  satuan: over.satuan ?? "kg",
  jumlah: over.jumlah ?? 100,
  dariBaris: over.dariBaris ?? 1,
  nilaiTertahan: over.nilaiTertahan ?? 0n,
  janggal: over.janggal ?? false,
});

const h = (over: Partial<HargaSatuan> = {}): HargaSatuan => ({
  kategori: over.kategori ?? "bahan",
  nama: over.nama ?? "Semen PC",
  satuan: over.satuan ?? "kg",
  harga: over.harga ?? 1_500n,
});

describe("hitungBiaya", () => {
  it("mengalikan kebutuhan dengan harga satuan", () => {
    const r = hitungBiaya([k({ jumlah: 100 })], [h({ harga: 1_500n })]);
    expect(r.baris[0].biaya).toBe(150_000n);
    expect(r.totalBiaya).toBe(150_000n);
    expect(r.berharga).toBe(1);
  });

  it("sumber daya TANPA harga bernilai null, BUKAN nol", () => {
    /*
     * Nol berarti "gratis" dan diam-diam mengecilkan total; null berarti "belum
     * diketahui" dan memaksa angkanya dilaporkan belum lengkap. Bedanya menentukan
     * apakah orang salah menawar atau tidak.
     */
    const r = hitungBiaya([k({ nama: "Pasir" })], []);
    expect(r.baris[0].biaya).toBeNull();
    expect(r.baris[0].harga).toBeNull();
    expect(r.totalBiaya).toBe(0n);
    expect(r.belumBerharga).toBe(1);
  });

  it("harga nol diperlakukan sebagai belum berharga, bukan gratis", () => {
    const r = hitungBiaya([k({ jumlah: 100 })], [h({ harga: 0n })]);
    expect(r.baris[0].harga).toBeNull();
    expect(r.baris[0].biaya).toBeNull();
    expect(r.berharga).toBe(0);
    expect(r.belumBerharga).toBe(1);
  });

  it("harga dijodohkan lewat kategori + nama + satuan, bukan nama saja", () => {
    // "Semen PC (kg)" dan "Semen PC (zak)" adalah dua barang dengan harga yang
    // berbeda jauh. Menjodohkan lewat nama saja memasang harga zak pada kilogram.
    const r = hitungBiaya(
      [k({ satuan: "kg", jumlah: 100 }), k({ satuan: "zak", jumlah: 2 })],
      [h({ satuan: "kg", harga: 1_500n })],
    );
    expect(r.baris[0].biaya).toBe(150_000n);
    expect(r.baris[1].biaya).toBeNull();
  });

  it("besar-kecil huruf satuan bukan pembeda", () => {
    const r = hitungBiaya([k({ satuan: "Kg" })], [h({ satuan: "kg" })]);
    expect(r.baris[0].biaya).toBe(150_000n);
  });

  it("kategori yang berbeda tidak saling meminjam harga", () => {
    // Upah "Pekerja" dan bahan bernama sama bukan hal yang sama.
    const r = hitungBiaya([k({ kategori: "upah" })], [h({ kategori: "bahan" })]);
    expect(r.baris[0].biaya).toBeNull();
  });

  it("total per kategori hanya menjumlah yang sudah berharga", () => {
    const r = hitungBiaya(
      [
        k({ nama: "Semen PC", jumlah: 100 }),
        k({ nama: "Pasir", jumlah: 50 }),
        k({ kategori: "upah", nama: "Pekerja", satuan: "OH", jumlah: 10 }),
      ],
      [h({ nama: "Semen PC", harga: 1_500n })],
    );
    const bahan = r.perKategori.find((x) => x.kategori === "bahan")!;
    expect(bahan.biaya).toBe(150_000n);
    expect(bahan.berharga).toBe(1);
    expect(bahan.total).toBe(2);
    expect(r.totalBiaya).toBe(150_000n);
  });
});

describe("bandingkanDenganNilaiProyek", () => {
  const dasar = {
    biayaRapl: 700_000_000n,
    nilaiProyek: 1_000_000_000n,
    nilaiRabTerhitung: 1_000_000_000n,
    nilaiRabTotal: 1_000_000_000n,
    sumberDayaBerharga: 10,
    sumberDayaTotal: 10,
  };

  it("margin = nilai RAB aktif − RAPL", () => {
    const p = bandingkanDenganNilaiProyek(dasar);
    expect(p.margin).toBe(300_000_000n);
    expect(p.marginPersen).toBeCloseTo(30, 5);
  });

  it("SELALU membawa keandalan – dan menolak disebut utuh saat cakupannya kurang", () => {
    /*
     * Ini inti seluruh berkas ini. Selisih Rp300 juta yang dihitung dari 72%
     * nilai RAB dan 40% sumber daya berharga BUKAN untung Rp300 juta: biaya
     * yang belum masuk akan mengecilkannya. Menyajikan selisih telanjang adalah
     * cara sistem ini bisa menyebabkan orang salah menawar.
     */
    const p = bandingkanDenganNilaiProyek({
      ...dasar,
      nilaiRabTerhitung: 720_000_000n,
      sumberDayaBerharga: 4,
    });
    expect(p.keandalan.cakupanNilai).toBeCloseTo(72, 5);
    expect(p.keandalan.cakupanHarga).toBeCloseTo(40, 5);
    expect(p.keandalan.utuh).toBe(false);
  });

  it("utuh HANYA kalau kedua cakupan penuh", () => {
    expect(bandingkanDenganNilaiProyek(dasar).keandalan.utuh).toBe(true);
    // Cakupan nilai penuh tapi harga belum → tetap tidak utuh.
    expect(
      bandingkanDenganNilaiProyek({ ...dasar, sumberDayaBerharga: 9 }).keandalan.utuh,
    ).toBe(false);
    // Harga penuh tapi nilai RAB belum → tetap tidak utuh.
    expect(
      bandingkanDenganNilaiProyek({ ...dasar, nilaiRabTerhitung: 999_000_000n }).keandalan.utuh,
    ).toBe(false);
  });

  it("biaya melebihi nilai proyek menghasilkan margin NEGATIF, bukan nol", () => {
    // Rugi harus terlihat sebagai rugi. Membatasi di nol menyembunyikan justru
    // keadaan yang paling perlu segera diketahui.
    const p = bandingkanDenganNilaiProyek({ ...dasar, biayaRapl: 1_200_000_000n });
    expect(p.margin).toBe(-200_000_000n);
    expect(p.marginPersen).toBeCloseTo(-20, 5);
  });

  it("nilai proyek nol tidak menghasilkan NaN", () => {
    const p = bandingkanDenganNilaiProyek({ ...dasar, nilaiProyek: 0n });
    expect(Number.isFinite(p.marginPersen)).toBe(true);
    expect(p.marginPersen).toBe(0);
  });
});
