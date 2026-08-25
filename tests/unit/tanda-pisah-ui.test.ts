import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TANDA PISAH DI TEKS UI: en-dash (–), BUKAN em-dash (—).
 *
 * Permintaan user 2026-08-19: *"di semua kode, AI selalu menjadikan — standar,
 * aku tidak mau begitu"* dan *"standar ai terlalu kelihatan dibuat oleh AI"*.
 * Alasannya bukan selera tipografi melainkan bau: em-dash yang bertaburan
 * membuat teks terbaca seperti keluaran mesin, dan MARLIN dibaca PPK, KKP, dan
 * mandor.
 *
 * Lingkupnya TEKS YANG DILIHAT ORANG saja – string literal dan teks JSX.
 * Komentar kode sengaja tidak dijaga: tidak pernah sampai ke layar, dan
 * memaksanya ikut hanya membuat tiap diff dipenuhi perubahan yang tak seorang
 * pun lihat.
 *
 * Penjaganya di sini, bukan di kepala orang: aturan gaya tanpa uji akan luntur
 * pada berkas ke-sekian.
 */

const AKAR = ["src", "tests", "e2e"];
const LEWATI = new Set(["node_modules", "generated", ".next"]);
const EM = "—";
/** Berkas ini sendiri – ia WAJIB memuat em-dash sebagai contoh uji. */
const KECUALI = "tests/unit/tanda-pisah-ui.test.ts";

/** Berkas + nomor baris yang memuat em-dash DI LUAR komentar. */
function temuanEmDash(src: string): number[] {
  const enum S {
    Normal,
    Baris,
    Blok,
    Sq,
    Dq,
    Bt,
  }
  let st: S = S.Normal;
  let baris = 1;
  const hit: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1] ?? "";
    if (c === "\n") baris++;
    switch (st) {
      case S.Normal:
        if (c === "/" && n === "/") st = S.Baris;
        else if (c === "/" && n === "*") st = S.Blok;
        else if (c === "'") st = S.Sq;
        else if (c === '"') st = S.Dq;
        else if (c === "`") st = S.Bt;
        else if (c === EM) hit.push(baris);
        break;
      case S.Baris:
        if (c === "\n") st = S.Normal;
        break;
      case S.Blok:
        if (c === "*" && n === "/") {
          i++;
          st = S.Normal;
        }
        break;
      default:
        if (c === "\\") {
          /*
           * `"—"` adalah em-dash yang ditulis sebagai escape. Melewatinya
           * begitu saja – karena backslash memang melewati satu karakter –
           * membuat penjaga ini punya lubang yang persis sebesar kebiasaan
           * menulis escape. Ditemukan lewat uji yang merah, bukan dugaan:
           * `kkp-cetak-lengkap` dan `strip-7-hari` memakai bentuk itu.
           */
          if (src.slice(i + 1, i + 6).toLowerCase() === "u2014") hit.push(baris);
          i++;
        } else if (c === EM) hit.push(baris);
        else if (
          (st === S.Sq && c === "'") ||
          (st === S.Dq && c === '"') ||
          (st === S.Bt && c === "`")
        )
          st = S.Normal;
    }
  }
  return hit;
}

function berkasSumber(dir: string, keluar: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (LEWATI.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) berkasSumber(p, keluar);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) keluar.push(p);
  }
  return keluar;
}

describe("teks UI memakai en-dash (–), bukan em-dash (—)", () => {
  const berkas = AKAR.flatMap((a) => {
    try {
      return berkasSumber(join(process.cwd(), a));
    } catch {
      return [];
    }
  });

  it("ada berkas yang diperiksa", () => {
    expect(berkas.length).toBeGreaterThan(100);
  });

  it("tidak ada em-dash di string maupun teks JSX", () => {
    const pelanggar: string[] = [];
    for (const f of berkas) {
      if (f.endsWith(KECUALI)) continue;
      const baris = temuanEmDash(readFileSync(f, "utf8"));
      if (baris.length > 0) {
        pelanggar.push(`${f.replace(process.cwd() + "/", "")}:${baris.join(",")}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});

describe("pendeteksi em-dash", () => {
  it("menemukan em-dash di string dan teks JSX", () => {
    expect(temuanEmDash('const a = "Paket — selesai";')).toEqual([1]);
    expect(temuanEmDash("<p>Paket — selesai</p>")).toEqual([1]);
    expect(temuanEmDash("const a = `Paket — ${x}`;")).toEqual([1]);
  });

  it("MELEWATI em-dash di komentar – itu tidak pernah sampai ke layar", () => {
    expect(temuanEmDash("// Paket — selesai")).toEqual([]);
    expect(temuanEmDash("/* Paket — selesai */")).toEqual([]);
    expect(temuanEmDash("/**\n * Paket — selesai\n */")).toEqual([]);
  });

  it("menemukan em-dash yang ditulis sebagai escape \\u2014", () => {
    expect(temuanEmDash('const a = "kosong: \\u2014";')).toEqual([1]);
    expect(temuanEmDash('const a = "kosong: \\u2013";')).toEqual([]);
  });

  it("melaporkan nomor baris yang benar", () => {
    expect(temuanEmDash('const a = 1;\n// x — y\nconst b = "c — d";')).toEqual([3]);
  });
});
