import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * LAPORAN TIDAK MENYEBUT ASAL NILAI DENGAN KATA-KATA.
 *
 * Ketetapan user 2026-09-04: *"semua informasi itu tidak perlu tercatat secara
 * eksplisit di laporan mana pun yang kamu buat baik gambar maupun pdf. cukup
 * mainkan warna pada informasinya"*.
 *
 * Diuji di lapisan SUMBER karena yang dijaga memang sifat sumbernya: tidak ada
 * satu pun tempat di penyusun dokumen yang MERAKIT kalimat itu. Memeriksa satu
 * PDF hasil render hanya membuktikan satu jalan; yang bocor justru jalan yang
 * lupa diperiksa — persis cara penanda lama tersebar ke banyak berkas.
 *
 * Komentar dikecualikan: yang dilarang mencetaknya, bukan menjelaskannya.
 */

const BERKAS = [
  "src/lib/pdf/harian-ringkas.ts",
  "src/lib/pdf/kegiatan.ts",
  "src/lib/photos.ts",
  "src/lib/photo-restamp/service.ts",
  "src/lib/photo-stamp/renderer.ts",
];

/** Buang komentar baris & blok supaya yang tersisa hanya yang bisa tercetak. */
function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const DILARANG = [
  /titik proyek/i,
  /jam tidak tercatat/i,
  /waktu unggah/i,
  /posisi saat unggah/i,
  /bukan GPS perangkat/i,
];

describe("penyusun dokumen tidak merakit kata asal nilai", () => {
  for (const berkas of BERKAS) {
    it(`${berkas} bersih dari frasa penanda`, () => {
      const kode = tanpaKomentar(readFileSync(berkas, "utf8"));
      const kena = DILARANG.filter((p) => p.test(kode)).map((p) => p.source);
      expect(kena).toEqual([]);
    });
  }
});
