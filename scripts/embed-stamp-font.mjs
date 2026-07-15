#!/usr/bin/env node
// Regenerasi src/lib/stamp-font.ts dari assets/fonts (subset Latin + simbol).
// Butuh `pyftsubset` (pip install fonttools). Jalankan bila font bundel berubah:
//   node scripts/embed-stamp-font.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const UNICODES = "U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+00B7,U+00B0,U+2026";
const tmp = mkdtempSync(path.join(os.tmpdir(), "fontsub-"));

function subset(src) {
  const out = path.join(tmp, path.basename(src) + ".subset.ttf");
  execFileSync("pyftsubset", [src, `--unicodes=${UNICODES}`, `--output-file=${out}`, "--layout-features=*", "--no-hinting", "--desubroutinize"]);
  return readFileSync(out).toString("base64");
}

const reg = subset("assets/fonts/DejaVuSans.ttf");
const bold = subset("assets/fonts/DejaVuSans-Bold.ttf");
const content = `// DIGENERATE otomatis (scripts/embed-stamp-font.mjs) — JANGAN edit manual.
// Subset DejaVu Sans (Latin + simbol) untuk cap foto, dibenamkan sebagai konstanta
// supaya SELALU tersedia di runtime tanpa bergantung filesystem/cwd/fontconfig.
// Sumber: assets/fonts/DejaVuSans{,-Bold}.ttf (Bitstream Vera / Public Domain).
export const STAMP_FONT_REGULAR_B64 = "${reg}";
export const STAMP_FONT_BOLD_B64 = "${bold}";
`;
writeFileSync("src/lib/stamp-font.ts", content);
console.log("wrote src/lib/stamp-font.ts", content.length, "chars");
