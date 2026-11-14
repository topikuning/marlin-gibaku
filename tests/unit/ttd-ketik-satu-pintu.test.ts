import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TANDA TANGAN KETIK HANYA LEWAT DUA PEMUAT YANG MEMBACA SAKELAR LOKASI (DECISIONS 766).
 *
 * Permintaan user 2026-11-14: tanda tangan yang terisi otomatis harus bisa
 * dinyalakan/dimatikan per lokasi, bawaan MATI – *"pastikan laporan harian juga
 * tekontrol dengan toggle on off ini"*.
 *
 * Sakelarnya dibaca di `penandatanganLokasi` dan dihormati di dua pemuat:
 * `muatTtdPdf` (PDF & Excel – harian, mingguan, bulanan, jadwal, Kurva S paket,
 * rencana, berkas termin, kiriman WA dan Drive) dan `muatTtdLaporan` (halaman
 * cetak). Jalur baru yang memanggil pembuat gambar ketik langsung akan mencetak
 * tanda tangan di lokasi yang mematikannya – tanpa satu uji pun merah. Uji ini
 * yang merah.
 */
const PEMBUAT = /\bttdKetik(?:Png|DataUrl)\s*\(/;
const BOLEH = new Set(["src/lib/export/ttd-ketik.ts", "src/lib/export/ttd-laporan.ts", "src/lib/pdf/ttd-gambar.ts"]);

const berkas = execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

describe("tanda tangan ketik satu pintu", () => {
  it("pembuat gambar ketik hanya dipanggil di dua pemuat (dan modulnya sendiri)", () => {
    const pemanggil = berkas.filter((f) => PEMBUAT.test(readFileSync(f, "utf8")));
    expect(pemanggil.filter((f) => !BOLEH.has(f))).toEqual([]);
  });

  it("kedua pemuat memeriksa sakelar lokasi sebelum membuat gambar ketik", () => {
    for (const f of ["src/lib/export/ttd-laporan.ts", "src/lib/pdf/ttd-gambar.ts"]) {
      const src = readFileSync(f, "utf8");
      const panggil = src.search(PEMBUAT);
      expect(panggil, f).toBeGreaterThan(-1);
      // Penjaga `!ketik` ada di fungsi yang sama, tepat sebelum gambar dibuat.
      expect(src.slice(Math.max(0, panggil - 300), panggil), f).toMatch(/!ketik\b/);
    }
  });

  it("sakelarnya dibaca dari lokasi di satu tempat", () => {
    const src = readFileSync("src/lib/export/ttd-laporan.ts", "utf8");
    expect(src).toMatch(/ttdKetik:\s*true/);
    expect(src).toMatch(/ketik:\s*lokasi\.ttdKetik/);
  });
});
