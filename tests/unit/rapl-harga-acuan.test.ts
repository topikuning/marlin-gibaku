// HARGA ACUAN TEMPLAT DI LAYAR HARGA RAPL (DECISIONS 804).
//
// Harga acuan templat hanya RUJUKAN (802). Di layar "Kebutuhan & harga" ia
// tampil di sebelah kolom harga supaya orang bisa memakainya dengan satu klik.
// Yang dijaga di sini:
//  - acuan sampai ke baris kebutuhan, dengan asalnya (katalog vs perkiraan
//    dari harga satuan RAB);
//  - komponen tanpa acuan (analisa kontrak/AHSP) tidak menghapus acuan dari
//    templat untuk sumber daya yang sama;
//  - dua acuan BERBEDA untuk satu sumber daya = tidak ada acuan (tidak dipilihkan);
//  - acuan tidak pernah jadi harga/biaya dengan sendirinya;
//  - kolomnya hanya ada bila ada acuan, tidak bisa diedit, dan tidak mengusir
//    Usulan AI dari 1.000 px pertama.
import { describe, expect, it } from "vitest";
import { agregasiKebutuhan, hitungBiaya, type ItemUntukRapl, type KomponenUntukRapl } from "@/lib/ahsp/rapl-calc";
import { kolomHarga } from "@/app/(app)/lokasi/[slug]/rapl/harga-kolom";

const item = (lk: string, komponen: KomponenUntukRapl[], sumber: "templat" | "kontrak" = "templat"): ItemUntukRapl => ({
  lineageKey: lk,
  code: lk,
  uraian: `Item ${lk}`,
  satuanNorm: "m3",
  volume: 10,
  amount: 10_000_000n,
  analisa: { kode: "T", uraian: "T", satuanNorm: "m3", komponen, sumber },
});

const cari = (h: ReturnType<typeof agregasiKebutuhan>, nama: string) => h.kebutuhan.find((k) => k.nama === nama)!;

describe("acuan di baris kebutuhan", () => {
  it("acuan katalog dan perkiraan RAB sampai ke baris kebutuhan beserta asalnya", () => {
    const h = agregasiKebutuhan([
      item("I#1", [
        { kategori: "bahan", nama: "Semen", satuan: "zak", koefisien: 7, hargaAcuan: 88_000, asalAcuan: "katalog" },
        { kategori: "bahan", nama: "Mesin es", satuan: "unit", koefisien: 1, hargaAcuan: 82_000_000, asalAcuan: "rab" },
      ]),
    ]);
    expect(cari(h, "Semen")).toMatchObject({ hargaAcuan: 88_000, asalAcuan: "katalog" });
    expect(cari(h, "Mesin es")).toMatchObject({ hargaAcuan: 82_000_000, asalAcuan: "rab" });
  });

  it("komponen tanpa acuan (analisa kontrak) tidak menghapus acuan templat untuk sumber daya yang sama", () => {
    const h = agregasiKebutuhan([
      item("I#1", [{ kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1 }], "kontrak"),
      item("I#2", [{ kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 2, hargaAcuan: 160_000, asalAcuan: "katalog" }]),
    ]);
    expect(cari(h, "Pekerja")).toMatchObject({ jumlah: 30, hargaAcuan: 160_000, asalAcuan: "katalog" });
  });

  it("dua acuan berbeda untuk satu sumber daya: tidak ada acuan, tidak dipilihkan", () => {
    const h = agregasiKebutuhan([
      item("I#1", [{ kategori: "jasa", nama: "Ongkos kirim", satuan: "ls", koefisien: 1, hargaAcuan: 500_000, asalAcuan: "rab" }]),
      item("I#2", [{ kategori: "jasa", nama: "Ongkos kirim", satuan: "ls", koefisien: 1, hargaAcuan: 700_000, asalAcuan: "rab" }]),
    ]);
    expect(cari(h, "Ongkos kirim")).toMatchObject({ hargaAcuan: null, asalAcuan: null });
  });

  it("acuan bukan harga: tanpa HSD, baris tetap belum berharga", () => {
    const h = agregasiKebutuhan([
      item("I#1", [{ kategori: "bahan", nama: "Semen", satuan: "zak", koefisien: 7, hargaAcuan: 88_000, asalAcuan: "katalog" }]),
    ]);
    const b = hitungBiaya(h.kebutuhan, []);
    expect(b.baris[0]).toMatchObject({ harga: null, biaya: null, hargaAcuan: 88_000 });
    expect(b.totalBiaya).toBe(0n);
  });
});

describe("kolom Harga acuan", () => {
  const ids = (k: { field?: unknown; colId?: string }[]) => k.map((c) => String(c.colId ?? c.field));

  it("hanya ada bila ada acuan, tepat sesudah Harga satuan, tidak bisa diedit", () => {
    expect(ids(kolomHarga({ canInput: true, adaDraf: false }))).not.toContain("hargaAcuanNum");
    const kolom = kolomHarga({ canInput: true, adaDraf: false, adaAcuan: true });
    const k = ids(kolom);
    expect(k.indexOf("hargaAcuanNum")).toBe(k.indexOf("hargaNum") + 1);
    expect(kolom.find((c) => c.field === "hargaAcuanNum")?.editable).toBeFalsy();
  });

  it("dengan draf AI: Usulan AI tetap di 1.000 px pertama dan acuan tetap ada", () => {
    const kolom = kolomHarga({ canInput: true, adaDraf: true, adaAcuan: true });
    let x = 48;
    for (const c of kolom) {
      x += c.width ?? c.minWidth ?? 200;
      if (c.field === "usulanAiNum") break;
    }
    expect(x).toBeLessThanOrEqual(1000);
    expect(ids(kolom)).toContain("hargaAcuanNum");
  });
});
