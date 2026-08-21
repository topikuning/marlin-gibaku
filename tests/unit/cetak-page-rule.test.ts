import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * PENJAGA: SETIAP HALAMAN CETAK MENENTUKAN UKURAN KERTAS & MARGINNYA SENDIRI
 * (DECISIONS 395).
 *
 * Ketahuan dari cetakan produksi yang dikirim user 2026-08-20: dari LIMA
 * halaman di `src/app/cetak/`, empat menyetel `@page` dan satu — laporan harian
 * KKP, yang paling sering dicetak — tidak. Halaman itu mewarisi bawaan
 * peramban, jadi ukuran kertas dan marginnya berbeda-beda tergantung siapa yang
 * menekan Cetak dan dari peramban apa.
 *
 * Untuk dokumen yang diserahkan ke PPK, "tergantung perambannya" bukan jawaban
 * yang bisa dipertanggungjawabkan.
 *
 * Tidak ada galat apa pun yang terbit dari kelalaian ini — halamannya tetap
 * tercetak, hanya berbeda. Karena itu penjaganya statis.
 */

function halamanCetak(): string[] {
  return execFileSync("git", ["ls-files", "src/app/cetak/**/page.tsx"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("halaman cetak menentukan @page", () => {
  it("ada halaman cetak yang dipindai (penjaganya tidak kosong sendiri)", () => {
    // Tanpa penegasan ini, `git ls-files` yang gagal atau pola yang salah
    // membuat uji di bawah lulus dengan memeriksa NOL berkas.
    expect(halamanCetak().length).toBeGreaterThanOrEqual(5);
  });

  it("setiap halaman di src/app/cetak menyetel size + margin", () => {
    const lolos: string[] = [];
    for (const berkas of halamanCetak()) {
      const src = readFileSync(berkas, "utf8");
      const punyaPage = /@page\s*\{[^}]*\bsize\s*:/.test(src);
      const punyaMargin = /@page\s*\{[^}]*\bmargin\s*:/.test(src);
      if (!punyaPage || !punyaMargin) lolos.push(berkas);
    }
    expect(
      lolos,
      "Halaman cetak berikut menyerahkan ukuran kertas/margin ke bawaan\n" +
        "peramban, sehingga hasil cetaknya berbeda-beda antar orang:\n" +
        lolos.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("REGRESI: lebar minimum layar tidak dibawa ke kertas", () => {
    /*
     * A4 potret dikurangi margin 10mm menyisakan 190mm = 718px. `min-w-[720px]`
     * yang ikut berlaku saat mencetak membuat tepi kanan tabel terpotong keluar
     * kertas — persis yang terlihat di cetakan user 2026-08-20, dan tidak
     * pernah terlihat di layar.
     */
    const lolos: string[] = [];
    for (const berkas of halamanCetak()) {
      /*
       * Komentar dibuang dulu. Versi pertama penjaga ini menuduh berkas yang
       * SUDAH benar, karena komentar yang MENJELASKAN kenapa `min-w-[720px]`
       * berbahaya ikut terbaca sebagai pemakaiannya. Penjaga yang menuduh kode
       * benar akan dimatikan orang, bukan dituruti.
       */
      const src = readFileSync(berkas, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      for (const m of src.matchAll(/\bmin-w-\[(\d+)px\]([^"'`]*)/g)) {
        const lebar = Number(m[1]);
        if (lebar <= 700) continue;
        // Dibatalkan saat cetak → aman.
        if (m[2].includes("print:min-w-0")) continue;
        lolos.push(`${berkas} – min-w-[${lebar}px] tanpa print:min-w-0`);
      }
    }
    expect(lolos, lolos.join("\n")).toEqual([]);
  });
});
