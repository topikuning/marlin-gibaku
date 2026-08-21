/*
 * SUDAH SAMPAI KE MANA LAPORAN HARIAN INI (DECISIONS 406).
 *
 * Permintaan user 2026-08-21: *"pada laporan harian informasi yang diutamakan
 * adalah apakah sudah diupload ke drive atau ke whatsap."*
 *
 * Yang diuji di sini bukan tampilannya melainkan KLAIMNYA: berapa berkas yang
 * benar-benar ada di Drive, kapan terakhir, dan kapan sebuah kegagalan pantas
 * disebut. Salah di sini berarti layar mengatakan "sudah" untuk hari yang
 * sebenarnya belum pernah sampai – dan orang berhenti mengeceknya.
 */
import { describe, expect, it } from "vitest";
import {
  ringkasDrive,
  ringkasKirim,
  statusKirim,
  type LogDrive,
} from "@/lib/laporan/riwayat-harian";

const jam = (h: number): Date => new Date(Date.UTC(2026, 7, 21, h, 0, 0));

const log = (o: Partial<LogDrive> & { status: string; createdAt: Date }): LogDrive => ({
  fileName: "Laporan Harian.pdf",
  webLink: null,
  error: null,
  ...o,
});

describe("ringkasDrive", () => {
  it("tanpa log sama sekali → tidak mengaku apa-apa", () => {
    expect(ringkasDrive([])).toEqual({ sukses: null, gagal: null });
  });

  it("menghitung BERKAS BERBEDA, bukan baris log", () => {
    /*
     * Satu unggahan ulang menulis baris baru untuk berkas yang sama. Kalau
     * barisnya yang dihitung, layar akan berkata "Drive · 6 berkas" untuk hari
     * yang isinya tiga – angka yang mengembang tiap kali orang menekan ulang.
     */
    const r = ringkasDrive([
      log({ status: "sukses", createdAt: jam(8), fileName: "Laporan Harian.pdf" }),
      log({ status: "sukses", createdAt: jam(8), fileName: "foto-1.jpg" }),
      log({ status: "sukses", createdAt: jam(9), fileName: "Laporan Harian.pdf" }),
    ]);
    expect(r.sukses?.berkas).toBe(2);
    expect(r.sukses?.pada).toEqual(jam(9));
  });

  it("tautan yang ditawarkan adalah PDF laporannya, bukan foto terakhir", () => {
    const r = ringkasDrive([
      log({ status: "sukses", createdAt: jam(9), fileName: "foto-9.jpg", webLink: "https://drive/foto" }),
      log({ status: "sukses", createdAt: jam(8), fileName: "Laporan Harian.pdf", webLink: "https://drive/pdf" }),
    ]);
    expect(r.sukses?.tautan).toBe("https://drive/pdf");
  });

  it("kegagalan TERBARU disebut", () => {
    const r = ringkasDrive([
      log({ status: "sukses", createdAt: jam(8) }),
      log({ status: "gagal", createdAt: jam(10), error: "kuota Drive habis" }),
    ]);
    expect(r.gagal).toEqual({ pada: jam(10), pesan: "kuota Drive habis" });
  });

  it("kegagalan yang SUDAH disusul keberhasilan tidak dilaporkan lagi", () => {
    /*
     * Lencana merah untuk kegagalan yang sudah beres membuat orang mengulang
     * unggahan yang tidak perlu – dan lebih buruk, membuat lencana merah
     * berikutnya ikut diabaikan.
     */
    const r = ringkasDrive([
      log({ status: "gagal", createdAt: jam(8), error: "jaringan putus" }),
      log({ status: "sukses", createdAt: jam(10) }),
    ]);
    expect(r.gagal).toBeNull();
    expect(r.sukses?.pada).toEqual(jam(10));
  });
});

describe("statusKirim", () => {
  it("Drive dan WhatsApp TIDAK saling menggantikan", () => {
    // Drive itu arsip yang diperiksa KKP, WhatsApp itu kabar ke orang. Satu
    // terisi tidak membuat yang lain selesai.
    expect(statusKirim({ drive: true, wa: false })).toBe("sebagian");
    expect(statusKirim({ drive: false, wa: true })).toBe("sebagian");
    expect(statusKirim({ drive: true, wa: true })).toBe("lengkap");
    expect(statusKirim({ drive: false, wa: false })).toBe("belum");
  });
});

describe("ringkasKirim", () => {
  it("`belum` hanya menghitung yang tidak sampai ke DUA-DUANYA", () => {
    const r = ringkasKirim([
      { drive: true, wa: true },
      { drive: true, wa: false },
      { drive: false, wa: true },
      { drive: false, wa: false },
      { drive: false, wa: false },
    ]);
    expect(r).toEqual({ total: 5, drive: 2, wa: 2, belum: 2 });
  });

  it("tanpa laporan sama sekali → nol, bukan pembagian nol", () => {
    expect(ringkasKirim([])).toEqual({ total: 0, drive: 0, wa: 0, belum: 0 });
  });
});
