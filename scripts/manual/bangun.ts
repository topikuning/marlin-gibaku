/**
 * BANGUN buku manual: Markdown → HTML → PDF A4 (DECISIONS 365).
 *
 *   pnpm manual:bangun
 *
 * Tidak menambah dependensi runtime: `marked` hanya devDependency, dan PDF-nya
 * dicetak oleh Chromium yang memang sudah ada lewat Playwright. `pdfkit` yang
 * dipakai blanko KKP sengaja TIDAK dipakai di sini — ia menggambar secara
 * programatik, cocok untuk formulir baku, tidak untuk buku berisi prosa panjang
 * dan gambar.
 *
 * ### Yang membuat skrip ini gagal, dan itu disengaja
 *
 * Naskah menyebut gambar lewat id. Kalau id-nya tidak ada di manifes — salah
 * ketik, gambar dihapus, bab disalin dari tempat lain — buku tetap terbit
 * dengan kotak kosong yang tak seorang pun perhatikan sampai sudah dicetak.
 * Karena itu ketidakcocokan apa pun MENGGAGALKAN pembangunan, dua arah:
 * gambar yang disebut tapi tidak ada, DAN gambar yang dijepret tapi tak pernah
 * dipakai.
 */

import { chromium } from "@playwright/test";
import { marked } from "marked";
import { readFile, readdir, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const AKAR = path.resolve("docs/manual");
const GAMBAR = path.join(AKAR, "gambar");
const KELUARAN = path.resolve("docs/manual/keluaran");

type Manifes = { id: string; keterangan: string; peran: string; lebar: string };

/** Bab diurutkan dari NAMA BERKAS (`01-…`), bukan daftar terpisah yang bisa basi. */
async function daftarBab(): Promise<string[]> {
  const isi = await readdir(path.join(AKAR, "bab"));
  return isi.filter((f) => f.endsWith(".md")).sort();
}

const GAYA = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #0f172a; font-size: 10.5pt; line-height: 1.55;
  }
  h1 { font-size: 20pt; margin: 0 0 4mm; color: #1e3a8a; }
  /* Tiap bab mulai di halaman baru — buku yang babnya menyambung di tengah
     halaman sulit dibuka orang yang mencari satu bagian saja. */
  h1:not(:first-of-type) { page-break-before: always; }
  h2 { font-size: 14pt; margin: 8mm 0 3mm; color: #1e3a8a; }
  h3 { font-size: 11.5pt; margin: 6mm 0 2mm; }
  h2, h3 { page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  code { background: #f1f5f9; padding: 0.5mm 1.2mm; border-radius: 1mm; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; }
  th, td { border: 0.3mm solid #e2e8f0; padding: 1.6mm 2mm; text-align: left; vertical-align: top; }
  th { background: #f8fafc; }
  blockquote {
    margin: 3mm 0; padding: 2mm 3mm; border-left: 1mm solid #2563eb;
    background: #eff6ff; color: #1e3a8a;
  }
  /* Gambar TIDAK boleh terpotong dua halaman: setengah tangkapan layar tidak
     mengajarkan apa pun. */
  figure { margin: 4mm 0; page-break-inside: avoid; }
  figure img {
    display: block; width: 100%; height: auto;
    border: 0.3mm solid #e2e8f0; border-radius: 1.5mm;
  }
  figure.ponsel img { width: 62mm; margin: 0 auto; }
  figcaption {
    margin-top: 1.5mm; font-size: 8.5pt; color: #64748b; text-align: center;
  }
  .sampul { text-align: center; padding-top: 60mm; page-break-after: always; }
  .sampul h1 { font-size: 30pt; border: 0; }
  .sampul p { color: #64748b; }
`;

async function main(): Promise<void> {
  const manifesMentah = await readFile(path.join(GAMBAR, "manifes.json"), "utf8").catch(() => null);
  if (!manifesMentah) {
    throw new Error("Belum ada gambar. Jalankan `pnpm manual:tangkap` lebih dulu.");
  }
  const manifes: Manifes[] = JSON.parse(manifesMentah);
  const perId = new Map(manifes.map((m) => [m.id, m]));

  const bab = await daftarBab();
  if (bab.length === 0) throw new Error("Tidak ada bab di docs/manual/bab/.");

  const dipakai = new Set<string>();
  const hilang: string[] = [];
  const tanpaBerkas: string[] = [];

  let badan = "";
  for (const berkas of bab) {
    const md = await readFile(path.join(AKAR, "bab", berkas), "utf8");

    /*
     * Sintaks gambar SENGAJA khusus: `{{gambar:id}}` pada barisnya sendiri.
     *
     * Bukan `![](...)` Markdown biasa, supaya keterangannya diambil dari
     * manifes — satu tempat — dan tidak bisa berselisih dengan yang tertulis di
     * naskah. Keterangan yang disalin ke dua tempat cepat atau lambat berbeda.
     */
    const diganti = md.replace(/^\{\{gambar:([a-z0-9-]+)\}\}$/gm, (_, id: string) => {
      const m = perId.get(id);
      if (!m) {
        hilang.push(`${berkas} → ${id}`);
        return "";
      }
      dipakai.add(id);
      return `<figure class="${m.lebar}"><img src="../gambar/${id}.png" alt="${escapeHtml(
        m.keterangan,
      )}"><figcaption>${escapeHtml(m.keterangan)}</figcaption></figure>`;
    });

    badan += await marked.parse(diganti);
  }

  for (const m of manifes) {
    if (!dipakai.has(m.id)) tanpaBerkas.push(m.id);
    await access(path.join(GAMBAR, `${m.id}.png`)).catch(() => {
      hilang.push(`berkas gambar/${m.id}.png tidak ada`);
    });
  }

  const masalah = [
    ...hilang.map((h) => `gambar disebut naskah tapi tidak ada: ${h}`),
    ...tanpaBerkas.map((id) => `gambar dijepret tapi tidak pernah dipakai naskah: ${id}`),
  ];
  if (masalah.length) {
    throw new Error(`Naskah dan gambar tidak cocok:\n${masalah.map((m) => `  - ${m}`).join("\n")}`);
  }

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Manual MARLIN</title><style>${GAYA}</style></head><body>
<div class="sampul"><h1>MARLIN</h1>
<p>Buku Manual Pengguna</p>
<p>Pengendalian Proyek Kampung Nelayan Merah Putih</p></div>
${badan}</body></html>`;

  await mkdir(KELUARAN, { recursive: true });
  const berkasHtml = path.join(KELUARAN, "manual-marlin.html");
  await writeFile(berkasHtml, html);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    // `file://` supaya `gambar/<id>.png` relatif terbaca tanpa menyalin apa pun.
    await page.goto(`file://${berkasHtml}`, { waitUntil: "networkidle" });

    /*
     * Gambar harus BENAR-BENAR termuat, bukan sekadar ada berkasnya di disk.
     *
     * Dua hal itu berbeda, dan perbedaannya sempat menghasilkan PDF "sukses"
     * berisi sembilan kotak kosong: berkasnya ada di `docs/manual/gambar/`,
     * penjaga naskah-vs-manifes hijau, tapi HTML-nya ditulis di
     * `docs/manual/keluaran/` sehingga `gambar/x.png` menunjuk tempat yang
     * salah. Yang bisa membuktikan sebuah gambar terlihat hanyalah peramban
     * yang mencetaknya.
     */
    const gagalMuat = await page.evaluate(() =>
      [...document.images]
        .filter((i) => !i.complete || i.naturalWidth === 0)
        .map((i) => i.getAttribute("src") ?? "(tanpa src)"),
    );
    if (gagalMuat.length) {
      throw new Error(
        `${gagalMuat.length} gambar tidak termuat saat mencetak:\n${gagalMuat
          .map((g) => `  - ${g}`)
          .join("\n")}`,
      );
    }

    await page.pdf({
      path: path.join(KELUARAN, "manual-marlin.pdf"),
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8pt;color:#94a3b8;padding:0 16mm;display:flex;justify-content:space-between"><span>Manual MARLIN</span><span class="pageNumber"></span></div>',
      margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await browser.close();
  }

  process.stdout.write(
    `Manual dibangun: ${bab.length} bab, ${manifes.length} gambar\n  ${path.join(KELUARAN, "manual-marlin.pdf")}\n`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
