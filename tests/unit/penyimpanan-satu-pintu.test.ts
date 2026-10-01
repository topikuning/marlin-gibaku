/*
 * SEMUA BACA/ALAMAT/HAPUS BERKAS LEWAT SATU PINTU (DECISIONS 645).
 *
 * Berkas yang sudah tidak baru dipindah dari R2 ke arsip Lenovo. Hanya
 * `penyimpanan/berkas.ts` yang tahu berkas mana yang sudah pindah; pemanggil
 * yang membaca R2 langsung akan gagal persis pada berkas lama – PDF laporan
 * bulan lalu, dokumen kontrak, surat – dan baru ketahuan berminggu-minggu
 * setelah pemindahannya berjalan.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AKAR = join(__dirname, "../../src");
const TERLARANG = /\b(r2GetBuffer|r2PresignGet|r2Delete|r2HapusBanyak)\b/;

/** Yang BOLEH: R2 itu sendiri, pintunya, dan arsip berkas asli (kolomnya sendiri). */
const BOLEH = [
  "lib/r2.ts",
  "lib/penyimpanan/",
  "lib/arsip-asli/",
  // Pembersihan obyek YATIM: kunci yang tidak dirujuk siapa pun, jadi tidak
  // mungkin pernah dipindah (dijaga juga oleh penyimpanan-r2.test.ts).
  "lib/system/actions.ts",
  // Hanya menyebut namanya di komentar.
  "lib/r2-audit.ts",
];

function semuaBerkas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return semuaBerkas(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("penyimpanan satu pintu", () => {
  it("tidak ada yang membaca, memberi alamat, atau menghapus R2 langsung", () => {
    const pelanggar = semuaBerkas(AKAR)
      .map((p) => p.slice(AKAR.length + 1).replaceAll("\\", "/"))
      .filter((rel) => !BOLEH.some((b) => rel.startsWith(b)))
      .filter((rel) => TERLARANG.test(readFileSync(join(AKAR, rel), "utf8")));
    expect(pelanggar).toEqual([]);
  });

  it("system/actions.ts hanya memakai r2HapusBanyak untuk obyek yatim", () => {
    const s = readFileSync(join(AKAR, "lib/system/actions.ts"), "utf8");
    expect(s.match(/\br2(GetBuffer|PresignGet|Delete)\b/g)).toBeNull();
    expect(s.match(/await r2HapusBanyak\(/g)).toEqual(["await r2HapusBanyak("]);
    expect(s).toContain("await r2HapusBanyak(yatim)");
  });
});
