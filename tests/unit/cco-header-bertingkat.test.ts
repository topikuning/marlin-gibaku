import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";
import { flattenParsedRab, grandTotal } from "@/lib/rab/flatten";

/**
 * Berkas MC0 Buyat Tengah (user 2026-10-31, DECISIONS 727) – tiga sifat yang
 * masing-masing membuatnya ditolak atau terbaca salah:
 * 1. judul "… / PEKERJAAN TAMBAH KURANG (CCO)" di SATU sel (baris 2);
 * 2. header DUA tingkat: KONTRAK · MC0 · SELISIH di baris atas, PEKERJAAN
 *    TAMBAH / KURANG baru di baris bawahnya;
 * 3. nomor "6.1." yang diubah Excel jadi TANGGAL berformat "d.m.".
 * Fixture sintetis dengan bentuk yang sama; angka dibuat sendiri.
 */

type Isi = (string | number | Date | null)[];
const JUDUL = "LAMPIRAN MUTUAL CEK AWAL (MC 0%) / PEKERJAAN TAMBAH KURANG (CCO)";
/** Tanggal yang dibuat Excel dari ketikan "d.m." – disimpan UTC tengah malam. */
const tgl = (hari: number, bulan: number) => new Date(Date.UTC(2026, bulan - 1, hari));

/** Satu baris item: kontrak (vol, harga) → MC0 (vol, harga sama). */
const item = (no: string | Date, nama: string, volK: number, volM: number, harga: number, sat = "bh"): Isi => [
  no, nama, null, null,
  volK, sat, harga, volK * harga, 0.1,
  volM, sat, harga, volM * harga, 0.1,
  null, null, null, null, volK === volM ? "Tetap" : volM > volK ? "Tambah" : "Kurang",
];
const judul = (no: string | Date, nama: string): Isi => [no, nama];

async function berkas(opsi: { bertingkat: boolean; tanggalFmt?: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB MC0 DESA UJI");
  ws.getRow(2).getCell(1).value = JUDUL;
  ws.mergeCells("A2:O2");
  if (opsi.bertingkat) {
    ws.getRow(17).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN",
      ...Array(5).fill("KONTRAK"), ...Array(5).fill("MC0"), ...Array(4).fill("SELISIH"), "KETERANGAN"];
    ws.getRow(18).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN",
      "VOL", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT", "VOL", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT",
      "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN KURANG", "PEKERJAAN KURANG", "KETERANGAN"];
  } else {
    // Header satu tingkat seperti berkas CCO KKP biasa, tapi dengan judul yang sama.
    ws.getRow(17).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN",
      ...Array(5).fill("KONTRAK"), ...Array(5).fill("MC0"),
      "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN KURANG", "PEKERJAAN KURANG", "KETERANGAN"];
    ws.getRow(18).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN",
      "VOL", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT", "VOL", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT",
      "VOLUME", "JUMLAH", "VOLUME", "JUMLAH", "KETERANGAN"];
  }
  const baris: Isi[] = [
    judul("I", "PEKERJAAN PERSIAPAN"),
    item("1", "Buat Bedeng Pekerja", 50, 50, 1000, "m2"),
    judul("6", "Pekerjaan Pengadaan SMK3K"),
    judul(tgl(6, 1), "Penyiapan RK3K, terdiri atas :"),
    item("a", "Pembuatan Manual", 2, 2, 5000, "set"),
    item("b", "Kartu Identitas Pekerja", 50, 60, 700, "org"),
    judul(tgl(6, 2), "Sosialisasi K3, terdiri atas :"),
    item("a", "Induksi K3", 50, 40, 800, "org"),
    judul("III", "PEKERJAAN TAMBATAN PERAHU"),
    item("1", "Tiang Pancang", 10, 12, 90000, "m1"),
    item("2", "Balok Beton", 4, 4, 250000, "m3"),
  ];
  baris.forEach((isi, i) => {
    const r = ws.getRow(21 + i);
    r.values = isi;
    if (isi[0] instanceof Date) r.getCell(1).numFmt = opsi.tanggalFmt ?? "d.m.";
  });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Σ jumlah MC0 fixture (kolom M) – angka yang WAJIB keluar. */
const TOTAL_MC0 = 50 * 1000 + 2 * 5000 + 60 * 700 + 40 * 800 + 12 * 90000 + 4 * 250000;

describe("berkas MC0 bertingkat (Buyat Tengah, DECISIONS 727)", () => {
  it("judul berisi TAMBAH KURANG tidak dianggap header; header dua tingkat dibaca: volume & jumlah dari MC0", async () => {
    const { parsed, warnings } = await parseHpsBuffer(await berkas({ bertingkat: true }));
    const nodes = flattenParsedRab(parsed);
    expect(Number(grandTotal(nodes))).toBe(TOTAL_MC0);
    expect(warnings.some((w) => w.includes('blok "MC0"'))).toBe(true);
    expect(parsed.categories.map((c) => c.roman)).toEqual(["I", "III"]);
  });

  it("nomor yang disimpan Excel sebagai tanggal 'd.m.' dibaca sebagai nomornya – dan disebut", async () => {
    const { parsed, warnings } = await parseHpsBuffer(await berkas({ bertingkat: true }));
    const nodes = flattenParsedRab(parsed);
    expect(nodes.filter((n) => n.lineageKey.startsWith("I#6")).map((n) => [n.lineageKey, n.name])).toEqual([
      ["I#6", "Pekerjaan Pengadaan SMK3K"],
      ["I#6#6.1", "Penyiapan RK3K, terdiri atas :"],
      ["I#6#6.1#6.1.a", "Pembuatan Manual"],
      ["I#6#6.1#6.1.b", "Kartu Identitas Pekerja"],
      ["I#6#6.2", "Sosialisasi K3, terdiri atas :"],
      ["I#6#6.2#6.2.a", "Induksi K3"],
    ]);
    const w = warnings.filter((x) => /TANGGAL oleh Excel/.test(x));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^2 nomor pekerjaan/);
    expect(w[0]).toContain('"6.1."');
  });

  it("header satu tingkat dengan judul yang sama tetap terbaca seperti biasa", async () => {
    const { parsed } = await parseHpsBuffer(await berkas({ bertingkat: false }));
    expect(Number(grandTotal(flattenParsedRab(parsed)))).toBe(TOTAL_MC0);
  });

  it("tanggal berformat lain di kolom nomor TIDAK ditebak jadi nomor", async () => {
    const { parsed, warnings } = await parseHpsBuffer(await berkas({ bertingkat: true, tanggalFmt: "dd/mm/yyyy" }));
    const nodes = flattenParsedRab(parsed);
    expect(nodes.some((n) => n.code === "6.1")).toBe(false);
    expect(warnings.some((x) => /TANGGAL oleh Excel/.test(x))).toBe(false);
  });
});
