import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * PENJAGA: SETIAP TEMPAT MEMBUAT `Issue` MENULIS `source` SECARA TEGAS
 * (DECISIONS 392).
 *
 * Ketahuan 2026-08-20 saat user bertanya "masih ada inputan di beberapa tempat
 * atau bagaimana": dari EMPAT jalur pembuatan kendala, dua tidak menulis
 * `source` sama sekali dan jatuh ke default `manual` di skema. Akibatnya dua
 * dari empat nilai `IssueSource` – `laporan_harian` dan `ai` – **tidak pernah
 * diproduksi oleh data baru**, dan saringan "Sumber" di papan kendala
 * memberikan jawaban yang salah tanpa satu galat pun.
 *
 * Label yang salah lebih buruk daripada label yang tidak ada: yang pertama
 * dipercaya.
 *
 * Default di skema sengaja TIDAK dihapus (data lama membutuhkannya), jadi
 * kompilator tidak bisa menangkap kelalaian ini. Penjaganya statis.
 */

const JENDELA = 700;

function berkasSumber(): string[] {
  return execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("setiap pembuatan kendala menyebut sumbernya", () => {
  it("tidak ada issue.create yang mengandalkan default `manual`", () => {
    const lolos: string[] = [];

    for (const berkas of berkasSumber()) {
      const src = readFileSync(berkas, "utf8");
      // Seed sengaja tidak ikut: ia data contoh, bukan jalur yang dipakai orang.
      if (berkas.includes("/seed/")) continue;

      for (const m of src.matchAll(/\b(?:db|tx)\.issue\.create\(/g)) {
        const pos = m.index ?? 0;
        if (src.slice(pos, pos + JENDELA).includes("source:")) continue;
        lolos.push(`${berkas}:${src.slice(0, pos).split("\n").length}`);
      }
    }

    expect(
      lolos,
      "Pembuatan kendala berikut tidak menulis `source`, jadi diam-diam\n" +
        "berlabel \"Dicatat langsung\" di papan kendala:\n" +
        lolos.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });
});
