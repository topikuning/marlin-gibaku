/*
 * CARI CEPAT ⌘K – aturan murni (DECISIONS 684).
 *
 * Permintaan user 2026-10-17: pencarian lokasi/paket di topbar supaya bisa
 * pindah ke lokasi lain tanpa kembali ke menu Lokasi lalu mencari lagi.
 */
import { describe, expect, it } from "vitest";
import { catatKunjungan, hrefLokasiSerupa, kunciKunjungan, normalCari, saringCari } from "@/lib/cari-cepat/murni";

const e = (judul: string, cari = "") => ({ judul, cari });

describe("saringCari", () => {
  const daftar = [
    e("Bulak Lor", "Desa Bulak Kab. Jepara"),
    e("Kedung Mutih", "Desa Kedungmutih Kab. Demak"),
    e("Mutiara Bahari", "Kab. Rembang"),
    e("Tambak Mulyo", "Desa Mutih Wetan"),
  ];

  it("ketikan kosong: tidak ada hasil (yang tampil daftar terakhir dibuka)", () => {
    expect(saringCari(daftar, "  ")).toEqual([]);
  });

  it("judul berawalan ketikan lebih dulu, lalu awal kata, lalu yang cocok lewat keterangan", () => {
    expect(saringCari(daftar, "mut").map((x) => x.judul)).toEqual(["Mutiara Bahari", "Kedung Mutih", "Tambak Mulyo"]);
  });

  it("semua kata wajib cocok, boleh tersebar di judul dan keterangan", () => {
    expect(saringCari(daftar, "kedung demak").map((x) => x.judul)).toEqual(["Kedung Mutih"]);
    expect(saringCari(daftar, "kedung jepara")).toEqual([]);
  });

  it("tanpa beda huruf besar, tanda baca, dan diakritik", () => {
    expect(normalCari("Kab.  Pémalang–Utara")).toBe("kab pemalang utara");
    expect(saringCari(daftar, "KAB.DEMAK").map((x) => x.judul)).toEqual(["Kedung Mutih"]);
  });

  it("nilai sama: urutan abjad dari server dipertahankan", () => {
    expect(saringCari([e("Desa B", "x"), e("Desa A", "x")], "x").map((x) => x.judul)).toEqual(["Desa B", "Desa A"]);
  });
});

describe("hrefLokasiSerupa – lokasi lain di tab yang sama", () => {
  it("dari luar halaman lokasi: ringkasan lokasi tujuan", () => {
    expect(hrefLokasiSerupa("/paket/abc", "krakahan")).toBe("/lokasi/krakahan");
    expect(hrefLokasiSerupa("/lokasi", "krakahan")).toBe("/lokasi/krakahan");
  });

  it("dari tab lokasi: tab yang sama di lokasi tujuan", () => {
    expect(hrefLokasiSerupa("/lokasi/mutih/rab", "krakahan")).toBe("/lokasi/krakahan/rab");
    expect(hrefLokasiSerupa("/lokasi/mutih/harian/2026-10-01", "krakahan")).toBe("/lokasi/krakahan/harian/2026-10-01");
  });

  it("slide satu sarana: berhenti di daftar sarana – kuncinya milik RAB lokasi asal", () => {
    expect(hrefLokasiSerupa("/lokasi/mutih/foto-sarpras/III", "krakahan")).toBe("/lokasi/krakahan/foto-sarpras");
  });
});

describe("kunciKunjungan & catatKunjungan – terakhir dibuka", () => {
  const id = "7f0c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
  it("halaman lokasi & paket dicatat, halaman lain tidak", () => {
    expect(kunciKunjungan("/lokasi/kedung-mutih/rab")).toBe("l:kedung-mutih");
    expect(kunciKunjungan(`/paket/${id.toUpperCase()}/lokasi`)).toBe(`p:${id}`);
    expect(kunciKunjungan("/paket/baru")).toBeNull();
    expect(kunciKunjungan("/lokasi")).toBeNull();
    expect(kunciKunjungan("/keuangan")).toBeNull();
  });

  it("yang terbaru di depan, tanpa duplikat, paling banyak enam", () => {
    expect(catatKunjungan(["l:a", "l:b", "l:c"], "l:b")).toEqual(["l:b", "l:a", "l:c"]);
    expect(catatKunjungan(["1", "2", "3", "4", "5", "6"], "7")).toEqual(["7", "1", "2", "3", "4", "5"]);
  });
});
