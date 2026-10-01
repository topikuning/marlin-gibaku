/**
 * Bangkitkan src/lib/photo-stamp/lebar-glyph.ts dari font cap foto
 * (assets/fonts/DejaVuSans*.ttf) – DECISIONS 644. Jalankan ulang bila font
 * cap diganti: `node scripts/lebar-glyph-cap.cjs`.
 */
const { readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const pnpm = join(__dirname, "..", "node_modules", ".pnpm");
const fkDir = readdirSync(pnpm).find((d) => d.startsWith("fontkit@"));
const fontkit = require(join(pnpm, fkDir, "node_modules", "fontkit"));

const KARAKTER = [];
for (let c = 0x20; c <= 0x7e; c++) KARAKTER.push(String.fromCharCode(c));
KARAKTER.push(..."–…•°·×²³’‘“”éèàáíóúÉÈÀÁÍÓÚñÑ");

function tabel(berkas) {
  const font = fontkit.openSync(join(__dirname, "..", "assets", "fonts", berkas));
  const out = {};
  for (const ch of KARAKTER) {
    const g = font.glyphForCodePoint(ch.codePointAt(0));
    out[ch] = Math.round((g.advanceWidth / font.unitsPerEm) * 10000) / 10000;
  }
  return out;
}

const isi = `// DIBANGKITKAN oleh scripts/lebar-glyph-cap.cjs – jangan disunting tangan.
// Lebar maju tiap huruf (per em) font cap foto, DejaVu Sans & DejaVu Sans Bold
// (assets/fonts). DECISIONS 644.
export const LEBAR_BIASA: Record<string, number> = ${JSON.stringify(tabel("DejaVuSans.ttf"))};
export const LEBAR_TEBAL: Record<string, number> = ${JSON.stringify(tabel("DejaVuSans-Bold.ttf"))};
`;
writeFileSync(join(__dirname, "..", "src", "lib", "photo-stamp", "lebar-glyph.ts"), isi);
console.log("lebar-glyph.ts ditulis:", KARAKTER.length, "huruf");
