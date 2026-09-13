// BERKAS "use server" HANYA BOLEH MENGEKSPOR FUNGSI ASYNC.
//
// Kegagalan produksi 2026-09-13: `next build` di Railway berhenti dengan
//
//     Only async functions are allowed to be exported in a "use server" file.
//     export const COOKIE_LEWATI = "marlin_wa_lewati";
//
// Satu baris konstanta di `verifikasi-wa/actions.ts`. Aturannya masuk akal:
// setiap ekspor di berkas `"use server"` menjadi endpoint yang bisa dipanggil
// peramban, jadi yang bukan fungsi tidak punya arti di sana.
//
// Yang membuatnya berbahaya: `tsc` diam, `eslint` diam, seluruh 3.116 uji unit
// dan 1.113 uji integrasi hijau. SATU-SATUNYA yang melihatnya `next build` —
// yang menurut aturan repo ini sengaja tidak dijalankan lokal. Jadi cacatnya
// baru ketahuan sesudah sampai ke Railway, dan rilis yang sudah di `main`
// gagal dibangun.
//
// Penjaga ini memindahkan penemuannya ke gerbang lokal, tempat ia seharusnya
// ditemukan: satu pemindaian teks, tanpa membangun apa pun.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const AKAR = join(import.meta.dirname, "..", "..");

/** Semua berkas .ts/.tsx yang dilacak git di src/ — bukan yang tercecer. */
function berkasSumber(): string[] {
  return execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], {
    cwd: AKAR,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/**
 * Apakah baris pertama yang berarti menyatakan "use server"?
 *
 * Namanya sengaja BUKAN `useServer`: lint membaca apa pun berawalan `use`
 * sebagai React hook dan menolaknya di dalam perulangan.
 */
function berdirektifServer(isi: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(isi);
}

/**
 * Ekspor yang BUKAN fungsi async, dan bukan sekadar tipe.
 *
 * `export type` dan `export interface` hilang saat kompilasi, jadi keduanya
 * tidak pernah menjadi endpoint dan memang diperbolehkan.
 */
function eksporTerlarang(isi: string): string[] {
  const salah: string[] = [];
  for (const baris of isi.split("\n")) {
    const t = baris.trim();
    if (!t.startsWith("export ")) continue;
    if (/^export\s+(type|interface)\b/.test(t)) continue;
    if (/^export\s+\{[^}]*\}\s*from\b/.test(t)) continue; // re-export
    if (/^export\s+async\s+function\b/.test(t)) continue;
    if (/^export\s+default\s+async\s+function\b/.test(t)) continue;
    // `export { type Foo }` – hanya tipe, aman.
    if (/^export\s+\{\s*type\s/.test(t) && !/,\s*[a-z]/i.test(t.replace(/type\s+\w+/g, ""))) continue;
    salah.push(t.slice(0, 100));
  }
  return salah;
}

describe('berkas "use server" hanya mengekspor fungsi async', () => {
  it("tidak ada satu pun ekspor non-fungsi", () => {
    const pelanggar: string[] = [];
    for (const f of berkasSumber()) {
      const isi = readFileSync(join(AKAR, f), "utf8");
      if (!berdirektifServer(isi)) continue;
      for (const e of eksporTerlarang(isi)) pelanggar.push(`${f}: ${e}`);
    }
    expect(
      pelanggar,
      `ekspor ini akan menggagalkan \`next build\` - pindahkan ke berkas lain:\n${pelanggar.join("\n")}`,
    ).toEqual([]);
  });

  it("pemindainya memang mengenali pelanggarannya", () => {
    // Tanpa ini, uji di atas bisa hijau karena pemindaiannya tidak menemukan
    // apa pun – termasuk kalau ia salah membaca seluruh berkas.
    const rusak = `"use server";\n\nexport const COOKIE = "x";\n\nexport async function aksi() {}\n`;
    expect(berdirektifServer(rusak)).toBe(true);
    expect(eksporTerlarang(rusak)).toEqual(['export const COOKIE = "x";']);

    const benar = `"use server";\n\nexport type S = { a: 1 };\n\nexport async function aksi() {}\n`;
    expect(eksporTerlarang(benar)).toEqual([]);
  });

  it("berkas yang BUKAN use server tidak ikut diperiksa", () => {
    expect(berdirektifServer(`"use client";\nexport const X = 1;\n`)).toBe(false);
    expect(berdirektifServer(`export const X = 1;\n`)).toBe(false);
    // Komentar di atas direktifnya tidak membuatnya luput.
    expect(berdirektifServer(`// catatan\n"use server";\n`)).toBe(true);
    expect(berdirektifServer(`/* blok */\n"use server";\n`)).toBe(true);
  });
});
