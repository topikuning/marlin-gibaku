import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PAGAR TAMPILAN HP: isi tidak boleh mendorong halaman ke samping (DECISIONS 765).
 *
 * Keluhan user 2026-11-12, tangkapan layar Ringkasan lokasi di HP: "tampilanmu
 * berantakan!". Satu judul kendala yang panjang membuat halaman selebar 861 px:
 * wadah `grid gap-4 lg:grid-cols-3` di HP tidak punya kolom tertulis, dan isi
 * grid (teks `truncate`) mendorong kolom otomatisnya melewati layar. Pola itu
 * ada di ±150 wadah. Kelas kedua: URL tanpa spasi di /sistem (616 px).
 *
 * Obatnya dua aturan dasar di `globals.css`. Uji ini menjaga keduanya tetap
 * ada dan tetap di `@layer base` (supaya utility `min-w-*` masih bisa
 * menimpanya). Sapuan E2E ponsel menjaga hasilnya dengan data seed berjudul
 * panjang.
 */
const css = readFileSync(join(__dirname, "..", "..", "src", "app", "globals.css"), "utf8");
const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Isi blok `@layer base { … }` (kurung kurawal dihitung). */
function blokBase(s: string): string {
  const i = s.indexOf("@layer base");
  expect(i, "@layer base tidak ditemukan").toBeGreaterThanOrEqual(0);
  let d = 0;
  const mulai = s.indexOf("{", i);
  for (let j = mulai; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}" && --d === 0) return s.slice(mulai + 1, j);
  }
  throw new Error("@layer base tidak tertutup");
}

describe("isi tidak mendorong halaman ke samping", () => {
  const base = blokBase(tanpaKomentar);

  it("isi grid boleh menyempit sampai lebar kolomnya", () => {
    expect(base).toMatch(/\.grid\s*>\s*\*\s*,\s*\.inline-grid\s*>\s*\*\s*\{\s*min-width:\s*0;?\s*\}/);
  });

  it("kata tanpa spasi dipatahkan bila tidak muat di barisnya", () => {
    expect(base).toMatch(/body\s*\{[^}]*overflow-wrap:\s*break-word/);
  });

  it("keduanya di @layer base, bukan di luar lapisan (utility harus tetap bisa menimpa)", () => {
    const luar = tanpaKomentar.replace(base, "");
    expect(luar).not.toMatch(/\.grid\s*>\s*\*/);
  });
});
