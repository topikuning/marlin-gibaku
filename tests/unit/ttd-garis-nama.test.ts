/*
 * GARIS PIJAK TANDA TANGAN PDF = tepi atas baris nama, DIUKUR (DECISIONS 763).
 *
 * Blanko harian dan blok tanda tangan periodik dulu memakai angka tetap (70 dan
 * 68 pt) sebagai jarak tepi atas blok ke baris nama. Baris namanya ternyata
 * ±10 pt lebih tinggi, jadi coretan berpijak DI BAWAH nama dan menimpanya –
 * kelihatan begitu tanda tangan ketik mengisi setiap slot bernama.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createFormA4Doc, PDF_FONT } = await import("@/lib/pdf/document");
const { ruangSampaiNama } = await import("@/lib/pdf/ttd-gambar");
const { PAD_Y_GRID } = await import("@/lib/pdf/grid");

const PEMISAH = "\n\n\n\n\n";

function tinggiBaris(fontSize: number) {
  const doc = createFormA4Doc();
  doc.font(PDF_FONT.regular).fontSize(fontSize);
  return { doc, lh: doc.currentLineHeight(true) };
}

describe("ruang sampai baris nama", () => {
  it("blanko harian: 3 baris kepala + 4 baris kosong → nama di baris ke-8", () => {
    const { doc, lh } = tinggiBaris(7);
    const r = ruangSampaiNama(doc, { atas: "Mengetahui :\nWakil Sah PPK\n ", pemisah: PEMISAH, lebarKolom: 180, fontSize: 7 });
    expect(r).toBeCloseTo(PAD_Y_GRID + 7 * lh, 1);
    // Angka tetap lama (70 pt) jatuh di BAWAH tepi atas baris nama.
    expect(r).toBeLessThan(70);
  });

  it("blok periodik: 2 baris kepala → nama di baris ke-7, di atas angka lama 68 pt", () => {
    const { doc, lh } = tinggiBaris(7.5);
    const r = ruangSampaiNama(doc, { atas: "MENGETAHUI :\nWAKIL SAH PPK", pemisah: PEMISAH, lebarKolom: 250, fontSize: 7.5 });
    expect(r).toBeCloseTo(PAD_Y_GRID + 6 * lh, 1);
    expect(r).toBeLessThan(68);
  });

  it("peran/firma yang terbungkus menurunkan garis pijak sebanyak baris tambahannya", () => {
    const { doc, lh } = tinggiBaris(7.5);
    const pendek = ruangSampaiNama(doc, { atas: "DIPERIKSA :\nKONSULTAN PENGAWAS", pemisah: PEMISAH, lebarKolom: 120, fontSize: 7.5 });
    const panjang = ruangSampaiNama(doc, {
      atas: "DIPERIKSA :\nKONSULTAN PENGAWAS – CV Konsultan Bahari Nusantara Sejahtera Abadi",
      pemisah: PEMISAH,
      lebarKolom: 120,
      fontSize: 7.5,
    });
    const tambah = (panjang - pendek) / lh;
    expect(tambah).toBeGreaterThanOrEqual(1);
    expect(tambah).toBeCloseTo(Math.round(tambah), 3);
  });
});
