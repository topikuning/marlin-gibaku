import { describe, expect, it } from "vitest";
import { bulanDari, type PeriodeTerbaca } from "@/lib/waha/tanya-tanggal";
import { parseNiatDeterministik } from "@/lib/waha/parser-niat";

/**
 * REKAP BULANAN (audit 2026-08-28).
 *
 * Kadens pelaporan ke pemberi kerja bulanan, tetapi satu-satunya rekap yang ada
 * berhenti di pekan — sehingga "laporan bulanan" terbaca sebagai laporan harian
 * HARI INI.
 *
 * Yang dijaga di sini dua hal, dan yang kedua lebih penting daripada yang
 * pertama: niatnya dikenali, DAN aturan potong periodenya sama persis dengan
 * mingguan. Dua rekap dengan aturan berlainan akan menyebut dua angka untuk hal
 * yang sama, dan pembacanya tidak punya cara menebak mana yang benar.
 */

const niatDari = (teks: string) => {
  const h = parseNiatDeterministik(teks);
  return h.jenis === "yakin" ? h.kandidat.niat : h.jenis;
};

const periodeDi = (key: string): PeriodeTerbaca => ({
  mulai: key,
  akhir: key,
  satuHari: true,
  label: key,
  catatan: null,
});

describe("niat rekap bulanan dikenali", () => {
  const BULANAN = ["laporan bulanan", "rekap bulanan", "progress bulanan", "rekap bulan"];
  for (const teks of BULANAN) {
    it(`"${teks}" → laporan_bulanan`, () => {
      expect(niatDari(teks)).toBe("laporan_bulanan");
    });
  }

  it("tidak menelan rekap MINGGUAN", () => {
    // Kalau pola bulanan terlalu rakus, kadens yang sudah bekerja ikut rusak.
    expect(niatDari("laporan mingguan")).toBe("laporan_mingguan");
    expect(niatDari("rekap mingguan")).toBe("laporan_mingguan");
  });
});

describe("bulanDari: batas bulan kalender", () => {
  it("bulan yang SUDAH lewat dihitung penuh, tanpa catatan berjalan", () => {
    const b = bulanDari(periodeDi("2026-06-14"), "2026-08-28");
    expect(b.mulai).toBe("2026-06-01");
    expect(b.akhir).toBe("2026-06-30");
    expect(b.catatan).toBeNull();
  });

  it("bulan BERJALAN dipotong hari ini – dan pemotongannya DIKATAKAN", () => {
    // Diam-diam memotong berarti menerbitkan angka sebulan penuh yang isinya
    // baru separuh bulan.
    const b = bulanDari(periodeDi("2026-08-14"), "2026-08-28");
    expect(b.mulai).toBe("2026-08-01");
    expect(b.akhir).toBe("2026-08-28");
    expect(b.catatan).toMatch(/Bulan berjalan/);
  });

  it("hari terakhir bulan dihitung benar, termasuk Februari kabisat", () => {
    expect(bulanDari(periodeDi("2028-02-10"), "2028-12-31").akhir).toBe("2028-02-29");
    expect(bulanDari(periodeDi("2026-02-10"), "2026-12-31").akhir).toBe("2026-02-28");
    expect(bulanDari(periodeDi("2026-04-10"), "2026-12-31").akhir).toBe("2026-04-30");
  });

  it("label menyebut RENTANG PENUH bulannya, bukan potongannya", () => {
    // Judul "bulan 1 – 28 Agt" pada bulan berjalan akan terbaca seolah bulannya
    // memang berakhir tanggal 28. Rentangnya utuh; potongannya di catatan.
    const b = bulanDari(periodeDi("2026-08-14"), "2026-08-28");
    expect(b.label).toContain("bulan");
    expect(b.label).toMatch(/31/);
  });

  it("periode tak terbaca jatuh ke bulan BERJALAN, sama seperti pekanDari", () => {
    /*
     * Bukan dikembalikan apa adanya: `pekanDari` sudah lebih dulu memutuskan
     * bahwa acuan yang tak terbaca berarti "sekarang", dan dua resolver periode
     * yang berlainan sikapnya akan menghasilkan dua jawaban untuk kalimat yang
     * sama. Yang penting periodenya tetap DISEBUT di judul balasan, jadi
     * penanya bisa melihat bulan mana yang benar-benar dijawab.
     */
    const b = bulanDari(periodeDi("bukan-tanggal"), "2026-08-28");
    expect(b.mulai).toBe("2026-08-01");
    expect(b.akhir).toBe("2026-08-28");
  });
});
