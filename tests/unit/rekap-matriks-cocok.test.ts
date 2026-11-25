import { describe, expect, it } from "vitest";
import { cocokkanRekap } from "@/lib/daily-report/rekap-matriks/cocok";
import type { BarisRekap, NodeRab } from "@/lib/daily-report/rekap-matriks/jenis";

/**
 * PENCOCOKAN REKAP HARIAN → RAB AKTIF (DECISIONS 782). Permintaan user:
 * *"pastikan kamu tidak salah match"*. Nama pekerjaan berulang di tiap
 * bangunan; yang membedakan letaknya.
 */
let n = 0;
const b = (nama: string, satuan: string | null, isi = true): BarisRekap => ({
  excelRow: 100 + n++,
  kode: "",
  nama,
  satuan,
  volumeKontrak: null,
  judul: satuan == null,
  sel: isi && satuan != null ? [{ tanggal: "2026-10-30", volume: 1, kolom: "BE" }] : [],
});
const k = (lineageKey: string, name: string, unit: string | null = null, daun = unit != null): NodeRab => ({
  lineageKey,
  kind: daun ? "item" : "kategori",
  name,
  unit,
  volume: daun ? 10 : null,
  daun,
  jalur: lineageKey,
});

describe("cocokkanRekap", () => {
  it("nama yang berulang di dua bangunan jatuh ke bangunannya masing-masing (lewat urutan)", () => {
    n = 0;
    const baris = [b("GEDUNG A", null), b("Galian Tanah", "m3"), b("Beton K-225", "m3"), b("GEDUNG B", null), b("Galian Tanah", "m3"), b("Beton K-225", "m3")];
    const nodes = [k("A", "GEDUNG A"), k("A#1", "Galian Tanah", "m³"), k("A#2", "Beton K-225", "m3"), k("B", "GEDUNG B"), k("B#1", "Galian Tanah", "M3"), k("B#2", "Beton K-225", "m3")];
    const c = cocokkanRekap(baris, nodes);
    expect([1, 2, 4, 5].map((i) => c.get(baris[i]!.excelRow))).toEqual([
      { lineageKey: "A#1", cara: "urutan" },
      { lineageKey: "A#2", cara: "urutan" },
      { lineageKey: "B#1", cara: "urutan" },
      { lineageKey: "B#2", cara: "urutan" },
    ]);
  });

  it("item yang sudah tidak ada di RAB tidak 'mencuri' item bernama sama di bangunan lain", () => {
    n = 0;
    const baris = [b("GEDUNG A", null), b("Galian Tanah", "m3"), b("Beton K-225", "m3"), b("GEDUNG B", null), b("Galian Tanah", "m3"), b("Beton K-225", "m3")];
    // Galian Tanah gedung A dihapus adendum.
    const nodes = [k("A", "GEDUNG A"), k("A#2", "Beton K-225", "m3"), k("B", "GEDUNG B"), k("B#1", "Galian Tanah", "m3"), k("B#2", "Beton K-225", "m3")];
    const c = cocokkanRekap(baris, nodes);
    expect(c.get(baris[4]!.excelRow)).toEqual({ lineageKey: "B#1", cara: "urutan" });
    expect(c.get(baris[1]!.excelRow)).toMatchObject({ lineageKey: null, sebab: expect.stringMatching(/tidak ditemukan di RAB aktif/) });
  });

  it("nama sama tapi satuan beda tidak dicocokkan; yang punya rincian disebut; nama unik di tempat lain dicocokkan lewat nama", () => {
    n = 0;
    const baris = [b("Urugan Pasir", "m2"), b("Pagar", "m'"), b("Papan Nama", "bh")];
    const nodes = [k("I#1", "Urugan Pasir", "m3"), k("I#2", "Pagar", "m'", false), k("I#2#1", "Pagar seng", "m'"), k("X", "LAIN-LAIN"), k("X#9", "Papan Nama", "bh")];
    nodes[1]!.kind = "item";
    const c = cocokkanRekap(baris, nodes);
    expect(c.get(baris[0]!.excelRow)).toMatchObject({ lineageKey: null });
    expect(c.get(baris[1]!.excelRow)).toMatchObject({ lineageKey: null, sebab: expect.stringMatching(/punya rincian/) });
    expect(c.get(baris[2]!.excelRow)).toEqual({ lineageKey: "X#9", cara: "urutan" });
  });

  it("dua kandidat bernama sama yang letaknya tidak bisa dipastikan → tidak ditebak, kandidatnya disebut", () => {
    n = 0;
    // Berkas tanpa judul bangunan: "Bekisting" bisa milik gedung A atau B.
    const baris = [b("PEKERJAAN LAIN", null), b("Bekisting", "m2")];
    const nodes = [k("Z", "PEKERJAAN LAIN"), k("A", "GEDUNG A"), k("A#1", "Bekisting", "m2"), k("B", "GEDUNG B"), k("B#1", "Bekisting", "m2")];
    expect(cocokkanRekap(baris, nodes).get(baris[1]!.excelRow)).toEqual({
      lineageKey: null,
      sebab: expect.stringMatching(/Ada 2 item "Bekisting".*Pilih sendiri/),
      kandidat: ["A#1", "B#1"],
    });
  });

  it("dua item bernama sama berurutan di bangunan yang sama tetap cocok satu-satu", () => {
    n = 0;
    const baris = [b("GEDUNG A", null), b("Pembesian", "kg"), b("Pembesian", "kg"), b("GEDUNG B", null)];
    const nodes = [k("A", "GEDUNG A"), k("A#1", "Pembesian", "kg"), k("A#2", "Pembesian", "kg"), k("B", "GEDUNG B")];
    const c = cocokkanRekap(baris, nodes);
    expect([c.get(baris[1]!.excelRow), c.get(baris[2]!.excelRow)]).toEqual([
      { lineageKey: "A#1", cara: "urutan" },
      { lineageKey: "A#2", cara: "urutan" },
    ]);
  });
});
