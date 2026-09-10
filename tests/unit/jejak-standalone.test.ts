// POLA PENELUSURAN STANDALONE TIDAK BOLEH BERHENTI DI DIREKTORI .pnpm.
//
// Yang dijaga di sini satu kalimat: tiap pola `node_modules/.pnpm/...` di
// `outputFileTracingIncludes` harus menyebut isi paketnya, bukan berhenti di
// nama direktori .pnpm-nya.
//
// Sebabnya tidak kelihatan dari polanya. pnpm menaruh TAUTAN SIMBOLIK ke
// direktori di dalam paket — `@img+sharp-linux-x64@*/node_modules/@img/
// sharp-libvips-linux-x64` menunjuk ke paket libvips yang berdiri sendiri.
// Pola `@img+*/**` ikut mencocokkan entri tautan itu sendiri. Next 16.2
// membiarkannya; sejak 16.3 penelusur membacanya sebagai berkas dan seluruh
// build berhenti:
//
//   Is a directory (os error 21)
//   reading file ".../@img+sharp-linux-x64@0.35.4/node_modules/@img/sharp-libvips-linux-x64"
//
// Galat itu tidak menyebut satu pun berkas proyek ini, jadi kalau polanya
// suatu hari dipendekkan lagi "supaya rapi", yang menemukannya adalah build
// yang gagal tanpa petunjuk — bukan uji ini. Karena itu uji ini ada.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const konfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

/** Isi larik `outputFileTracingIncludes["/**"]`, apa adanya. */
function polaJejak(): string[] {
  const mulai = konfig.indexOf("outputFileTracingIncludes");
  expect(mulai, "outputFileTracingIncludes hilang dari next.config.ts").toBeGreaterThan(-1);
  const potong = konfig.slice(mulai, konfig.indexOf("},", konfig.indexOf("[", mulai)));
  return [...potong.matchAll(/"(\.\/[^"]+)"/g)].map((m) => m[1]);
}

describe("pola penelusuran berkas standalone", () => {
  it("paket sharp & @img tetap disebut – tanpa itu libvips-cpp.so tidak ikut", () => {
    const pola = polaJejak();
    expect(pola.some((p) => p.includes(".pnpm/sharp@"))).toBe(true);
    expect(pola.some((p) => p.includes(".pnpm/@img+"))).toBe(true);
  });

  it("tiap pola .pnpm turun sampai isi paket, tidak berhenti di direktori .pnpm", () => {
    for (const p of polaJejak()) {
      if (!p.includes("/.pnpm/")) continue;
      const sesudah = p.slice(p.indexOf("/.pnpm/") + "/.pnpm/".length);
      // "sharp@*/**" → satu segmen sebelum "**"  (TERLARANG)
      // "sharp@*/node_modules/sharp/**" → tiga segmen (aman)
      const segmen = sesudah.split("/").filter((s) => s && s !== "**");
      expect(
        segmen.length,
        `pola "${p}" berhenti di direktori .pnpm; ia akan ikut mencocokkan tautan simbolik ke direktori dan menggagalkan build`,
      ).toBeGreaterThan(1);
      expect(sesudah, `pola "${p}" harus menyebut node_modules paketnya`).toContain("node_modules/");
    }
  });
});
