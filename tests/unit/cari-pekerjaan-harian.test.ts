/*
 * KOTAK PILIH PEKERJAAN DI INPUT HARIAN TIDAK MENYEMBUNYIKAN HASIL DIAM-DIAM.
 *
 * Pertanyaan user 2026-10-03: *"bagaimana jika misal ada satu keyword yang
 * hasilnya lebih dari jumlah tampilan datamu di pelaksanaan harian?"* –
 * dulu daftar dipotong di 25 tanpa keterangan, jadi item ke-26 dst. tidak
 * terlihat dan terbaca "tidak ada di RAB". Selain itu beberapa kata harus
 * berurutan persis, jadi pencarian tidak bisa dipersempit.
 */
import { describe, expect, it } from "vitest";
import { cariPekerjaan } from "@/lib/daily-report/cari-pekerjaan";

const item = (i: number, nama: string, sub = "", category = "PEKERJAAN SHELTER") => ({
  code: `${i}.a`,
  name: nama,
  category,
  subPath: sub,
});

describe("cari pekerjaan di input harian", () => {
  const banyak = Array.from({ length: 40 }, (_, i) => item(i + 1, "Pekerjaan Kayu Bekesting Kolom", `${i + 1}. Kolom K${i + 1}`));

  it("menyebut jumlah seluruh hasil walau yang ditampilkan dibatasi", () => {
    const h = cariPekerjaan(banyak, "bekesting", 25);
    expect(h.tampil).toHaveLength(25);
    expect(h.total).toBe(40);
  });

  it("tanpa batas, semua hasil ditampilkan", () => {
    expect(cariPekerjaan(banyak, "bekesting", null).tampil).toHaveLength(40);
  });

  it("beberapa kata dicocokkan semuanya, urutan bebas", () => {
    const daftar = [
      item(1, "Pekerjaan Kayu Bekesting Kolom", "7. Kolom Struktur"),
      item(2, "Pekerjaan Kayu Bekesting Kolom", "8. Kolom Praktis"),
      item(3, "Pembesian Kolom", "8. Kolom Praktis"),
    ];
    const h = cariPekerjaan(daftar, "praktis bekesting", 25);
    expect(h.tampil.map((x) => x.code)).toEqual(["2.a"]);
    expect(h.total).toBe(1);
  });

  it("kata kosong tidak menampilkan apa pun", () => {
    expect(cariPekerjaan(banyak, "   ", 25)).toEqual({ tampil: [], total: 0 });
  });
});
