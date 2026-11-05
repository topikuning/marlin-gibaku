/*
 * KELAS WARNA HARUS PUNYA CSS (DECISIONS 740, menutup OPEN_ISSUES UI-04).
 *
 * Tailwind 4 membangun kelas warna dari token `--color-*` di `globals.css`.
 * Kelas yang menunjuk token yang TIDAK ADA (`border-border-muted`,
 * `bg-brand`, `text-warning-700`) tidak menghasilkan aturan CSS apa pun, dan
 * tidak ada yang mengeluh: build, typecheck, dan lint tetap hijau. Akibatnya
 * diam-diam: garis hilang, latar hilang, teks putih di atas latar yang tidak
 * terbentuk (nomor langkah aktif stepper RAPL tidak terlihat). Sampai
 * 2026-11-05 ada 34 berkas seperti itu, ditemukan satu-satu dengan mata.
 *
 * Uji ini menyusun CSS dengan Tailwind yang SAMA dengan build, lalu memeriksa
 * setiap kelas warna di `src/` benar-benar punya selector di hasilnya.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = process.cwd();
const rq = createRequire(path.join(AKAR, "package.json"));

async function susunCss(): Promise<string> {
  const tailwind = rq("@tailwindcss/postcss") as (o: { base: string }) => unknown;
  // postcss diambil dari tempat @tailwindcss/postcss memakainya – versi yang sama dengan build.
  const postcss = createRequire(rq.resolve("@tailwindcss/postcss"))("postcss") as (p: unknown[]) => {
    process: (css: string, o: { from: string }) => Promise<{ css: string }>;
  };
  const sumber = path.join(AKAR, "src/app/globals.css");
  return (await postcss([tailwind({ base: AKAR })]).process(readFileSync(sumber, "utf8"), { from: sumber })).css;
}

/** Bagian utilitas tanpa varian (`hover:md:bg-x/50` → `bg-x/50`). */
const inti = (k: string) => k.slice(k.lastIndexOf(":") + 1);

const UTIL_WARNA =
  /^-?(bg|text|border(-[trblxyse])?|ring(-offset)?|divide|outline|fill|stroke|from|to|via|decoration|placeholder|accent|caret|shadow)-([a-z][a-z0-9-]*)(\/\d+)?$/;

/** Utilitas berawalan sama yang BUKAN warna. */
const BUKAN_WARNA = new RegExp(
  "^(" +
    [
      "text-(xs|sm|base|lg|[2-9]?xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis)",
      "border(-[trblxyse])?-(solid|dashed|dotted|double|hidden|none|\\d+)",
      "border-(collapse|separate|spacing.*)",
      "bg-(fixed|local|scroll|clip-.*|origin-.*|no-repeat|repeat.*|cover|contain|center|top|bottom|left|right|none|gradient-.*|linear-.*|radial.*|conic.*|auto|blend-.*)",
      "shadow-(xs|sm|md|lg|xl|2xl|inner|none)",
      "ring(-offset)?-(\\d+|inset)",
      "outline-(\\d+|none|hidden|dashed|dotted|double|solid|offset-.*)",
      "divide-(x|y)(-.*)?",
      "divide-(solid|dashed|dotted|double|none)",
      "stroke-\\d+",
      "decoration-(solid|double|dotted|dashed|wavy|auto|from-font|clone|slice|\\d+)",
      "(from|to|via)-\\d.*",
      "text-(shadow-.*)",
      // Nama properti MapLibre (`peta-map.tsx`), bukan kelas.
      "text-(color|field|font|size|halo-.*|offset|anchor|opacity|justify|max-width|letter-spacing|transform|padding|rotate|allow-overlap|ignore-placement|optional|line-height|variable-anchor.*|radial-offset|keep-upright|writing-mode|pitch-alignment|rotation-alignment|translate.*)",
      "fill-(color|opacity|outline-color|antialias|pattern|sort-key|translate.*|extrusion-.*)",
    ].join("|") +
    ")$",
);

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated") continue;
      hasil.push(...berkasSumber(p));
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

describe("kelas warna di src/ semuanya dibangun Tailwind", () => {
  it("tidak ada kelas warna yang menunjuk token yang tidak ada", async () => {
    const css = await susunCss();
    const dibangun = new Set<string>();
    for (const m of css.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) dibangun.add(inti(m[1].replace(/\\(.)/g, "$1")));
    // Kontrol: kelas yang pasti ada harus terbaca ada – kalau tidak, uji ini sendiri yang rusak.
    expect(dibangun.has("text-ink")).toBe(true);
    expect(dibangun.has("bg-surface")).toBe(true);

    const mati = new Map<string, Set<string>>();
    for (const f of berkasSumber(path.join(AKAR, "src"))) {
      const isi = readFileSync(f, "utf8");
      // Seluruh teks berkas dipecah per pemisah kelas – termasuk literal templat
      // (`${a ? "bg-x" : "bg-y"}`), yang luput kalau hanya membaca isi tanda kutip.
      for (const k of isi.split(/[\s"'`{}()$,;<>]+/)) {
        const c = inti(k);
        if (!UTIL_WARNA.test(c) || BUKAN_WARNA.test(c) || dibangun.has(c)) continue;
        if (!mati.has(c)) mati.set(c, new Set());
        mati.get(c)!.add(path.relative(AKAR, f));
      }
    }
    const daftar = [...mati].map(([k, v]) => `${k}  ←  ${[...v].sort().join(", ")}`).sort();
    expect(daftar, `Kelas warna tanpa CSS (token tidak ada di globals.css):\n${daftar.join("\n")}`).toEqual([]);
  }, 60_000);
});
