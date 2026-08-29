import { describe, expect, it } from "vitest";
import {
  BATAS_USULAN_HARGA_AI,
  pilihTargetUsulan,
  type BarisTarget,
} from "@/lib/ahsp/usulan-target";
import { agregasiKebutuhan, type ItemUntukRapl } from "@/lib/ahsp/rapl-calc";

/**
 * PEMILIHAN TARGET DRAF HARGA AI (RAPL-03, DECISIONS 470).
 *
 * Kuota satu panggilan terbatas. Yang menentukan berguna-tidaknya panggilan itu
 * adalah SIAPA yang dipilih: sumber daya yang menahan Rp365 juta pekerjaan
 * beton, atau sumber daya yang menahan Rp2 juta.
 *
 * Versi pertama memilih apa adanya dari urutan tampil `keadaanHarga` —
 * kategori (upah → bahan → alat → fasilitas) lalu `jumlah` menurun. `jumlah`
 * adalah kuantitas fisik: 5.000 kg semen, 12 OH mandor, dan 0,3 jam excavator
 * berada di satu kolom yang sama, dan mengurutkannya berarti mengurutkan
 * satuan yang tidak sebanding. Akibatnya kuota habis untuk baris upah dengan
 * cacahan terbesar sementara bahan yang menahan sebagian besar nilai proyek
 * tidak pernah kebagian.
 */

function baris(
  nama: string,
  kategori: string,
  nilaiTertahan: bigint,
  harga: bigint | null = null,
): BarisTarget {
  return { kategori, nama, satuan: "kg", harga, nilaiTertahan };
}

describe("pilihTargetUsulan", () => {
  it("mendahulukan sumber daya yang menahan nilai RAB terbesar, bukan urutan tampil", () => {
    // Urutan masuk sengaja meniru `keadaanHarga`: seluruh upah lebih dulu,
    // baru bahan. Upahnya menahan sedikit; bahannya menahan hampir semuanya.
    const upah = Array.from({ length: BATAS_USULAN_HARGA_AI }, (_, i) =>
      baris(`Pekerja ${i}`, "upah", 2_000_000n),
    );
    const semen = baris("Semen PC 50 kg", "bahan", 365_000_000n);
    const besi = baris("Besi beton D16", "bahan", 180_000_000n);

    const { target } = pilihTargetUsulan([...upah, semen, besi], BATAS_USULAN_HARGA_AI);

    const nama = target.map((t) => t.nama);
    expect(nama).toContain("Semen PC 50 kg");
    expect(nama).toContain("Besi beton D16");
    expect(target[0].nama).toBe("Semen PC 50 kg");
  });

  it("tidak pernah memilih yang sudah berharga", () => {
    const { target, totalKosong } = pilihTargetUsulan([
      baris("Sudah ada", "bahan", 999_000_000n, 12_000n),
      baris("Belum ada", "bahan", 1_000n),
    ]);
    expect(target.map((t) => t.nama)).toEqual(["Belum ada"]);
    expect(totalKosong).toBe(1);
  });

  it("melaporkan berapa yang TIDAK ikut dimintakan", () => {
    const semua = Array.from({ length: 300 }, (_, i) =>
      baris(`Bahan ${i}`, "bahan", BigInt(300 - i) * 1_000_000n),
    );
    const hasil = pilihTargetUsulan(semua, BATAS_USULAN_HARGA_AI);
    expect(hasil.target).toHaveLength(BATAS_USULAN_HARGA_AI);
    expect(hasil.totalKosong).toBe(300);
    expect(hasil.tidakDiminta).toBe(275);
  });

  it("urutannya stabil saat nilai tertahannya sama", () => {
    const a = baris("Aspal", "bahan", 5_000_000n);
    const b = baris("Batu belah", "bahan", 5_000_000n);
    const pertama = pilihTargetUsulan([a, b], 2).target.map((t) => t.nama);
    const kedua = pilihTargetUsulan([b, a], 2).target.map((t) => t.nama);
    expect(pertama).toEqual(kedua);
  });
});

describe("nilaiTertahan dari agregasiKebutuhan", () => {
  const analisa = (kode: string, komponen: { nama: string; koefisien: number }[]) => ({
    kode,
    uraian: kode,
    satuanNorm: "m3",
    komponen: komponen.map((k) => ({
      kategori: "bahan",
      nama: k.nama,
      satuan: "kg",
      koefisien: k.koefisien,
    })),
  });

  const item = (
    code: string,
    amount: bigint,
    komponen: { nama: string; koefisien: number }[],
  ): ItemUntukRapl => ({
    lineageKey: code,
    code,
    uraian: code,
    satuanNorm: "m3",
    volume: 10,
    amount,
    analisa: analisa(code, komponen),
  });

  it("menjumlahkan nilai RAB item yang membutuhkan sumber daya itu", () => {
    const hasil = agregasiKebutuhan([
      item("A", 300_000_000n, [{ nama: "Semen", koefisien: 5 }]),
      item("B", 65_000_000n, [{ nama: "Semen", koefisien: 3 }]),
      item("C", 2_000_000n, [{ nama: "Pasir", koefisien: 1 }]),
    ]);
    const semen = hasil.kebutuhan.find((k) => k.nama === "Semen");
    const pasir = hasil.kebutuhan.find((k) => k.nama === "Pasir");
    expect(semen?.nilaiTertahan).toBe(365_000_000n);
    expect(pasir?.nilaiTertahan).toBe(2_000_000n);
  });

  it("satu item yang mendaftarkan sumber daya sama dua kali tidak dihitung dobel", () => {
    const hasil = agregasiKebutuhan([
      item("A", 100_000_000n, [
        { nama: "Semen", koefisien: 5 },
        { nama: "Semen", koefisien: 2 },
      ]),
    ]);
    const semen = hasil.kebutuhan.find((k) => k.nama === "Semen");
    expect(semen?.nilaiTertahan).toBe(100_000_000n);
    // Jumlah kebutuhannya TETAP menjumlahkan kedua koefisien.
    expect(semen?.jumlah).toBe(70);
  });
});
