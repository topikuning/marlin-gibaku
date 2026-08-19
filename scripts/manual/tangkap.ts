/**
 * TANGKAP screenshot buku manual (DECISIONS 365).
 *
 *   pnpm manual:tangkap            # semua gambar di daftar
 *   pnpm manual:tangkap hari-ini   # hanya id yang disebut
 *
 * Prasyarat: MARLIN jalan di `MANUAL_BASE_URL` (default http://localhost:3000)
 * dengan database contoh yang sudah di-seed.
 *
 * Skrip ini SENGAJA gagal keras. Screenshot yang gagal diam-diam menghasilkan
 * buku dengan gambar kosong atau — lebih buruk — gambar lama yang masih terlihat
 * masuk akal padahal layarnya sudah berubah.
 */

import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEMUA_GAMBAR, idGanda, type Gambar, type PeranPotret } from "./daftar-gambar";

const BASE = process.env.MANUAL_BASE_URL ?? "http://localhost:3000";
const SANDI = process.env.MANUAL_PASSWORD ?? "marlin123";
const KELUARAN = path.resolve("docs/manual/gambar");

const UKURAN = {
  ponsel: { width: 390, height: 844 },
  layar: { width: 1280, height: 900 },
} as const;

async function masuk(page: Page, peran: PeranPotret): Promise<void> {
  await page.goto(`${BASE}/masuk`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username atau email").fill(peran);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(SANDI);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 });
}

/**
 * Lokasi & paket contoh diambil DARI APLIKASI, bukan ditulis tetap di skrip.
 *
 * Slug yang di-hardcode akan diam-diam salah begitu seed berubah, dan gejalanya
 * berupa halaman 404 yang tetap terpotret sebagai gambar "berhasil".
 */
async function contohLokasi(page: Page): Promise<string> {
  await page.goto(`${BASE}/lokasi`, { waitUntil: "domcontentloaded" });
  const href = await page
    .locator('a[href^="/lokasi/"]')
    .first()
    .getAttribute("href", { timeout: 15_000 });
  const slug = href?.split("/")[2];
  if (!slug) throw new Error("Tidak menemukan satu pun lokasi contoh di /lokasi.");
  return slug;
}

async function jepret(page: Page, g: Gambar, lokasi: string): Promise<void> {
  const url = `${BASE}${g.path.replace("{lokasi}", lokasi)}`;
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (res && res.status() >= 400) {
    throw new Error(`${g.id}: ${url} menjawab ${res.status()}`);
  }
  if (g.tunggu) {
    await page.getByText(g.tunggu).first().waitFor({ timeout: 20_000 });
  }
  if (g.gulirKe) {
    await page.locator(g.gulirKe).first().scrollIntoViewIfNeeded({ timeout: 15_000 });
  }
  // Beri kesempatan grafik & gambar selesai — kurva-S menggambar setelah hidrasi.
  await page.waitForTimeout(1200);

  // CSS termuat DIPASTIKAN. Halaman tanpa stylesheet tetap terpotret dengan
  // rapi sebagai teks polos, dan itu pernah menipu saya sendiri (DECISIONS 352).
  const jumlahCss = await page.evaluate(() => document.styleSheets.length);
  if (jumlahCss === 0) throw new Error(`${g.id}: CSS tidak termuat — jangan dipakai.`);

  const berkas = path.join(KELUARAN, `${g.id}.png`);
  const target = g.potong ? page.locator(g.potong).first() : page;
  await target.screenshot({
    path: berkas,
    ...(g.potong ? {} : { fullPage: true }),
  });
}

async function main(): Promise<void> {
  const ganda = idGanda();
  if (ganda.length) throw new Error(`Id gambar ganda: ${ganda.join(", ")}`);

  const diminta = process.argv.slice(2);
  const daftar = diminta.length
    ? SEMUA_GAMBAR.filter((g) => diminta.includes(g.id))
    : SEMUA_GAMBAR;
  if (diminta.length && daftar.length !== diminta.length) {
    const tidakAda = diminta.filter((d) => !SEMUA_GAMBAR.some((g) => g.id === d));
    throw new Error(`Id tidak dikenal: ${tidakAda.join(", ")}`);
  }

  await mkdir(KELUARAN, { recursive: true });
  let browser: Browser | undefined;
  const gagal: string[] = [];
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    });

    // Dikelompokkan per peran supaya login-nya sekali per peran, bukan per
    // gambar — pembatas laju login (5 gagal / 15 menit) mudah tersentuh kalau
    // skrip ini dijalankan berulang saat menyunting naskah.
    // Gambar tanpa sesi dipotret lebih dulu, di konteks yang benar-benar bersih.
    const tanpaSesi = daftar.filter((g) => g.tanpaSesi);
    if (tanpaSesi.length) {
      const ctx = await browser.newContext({ viewport: UKURAN.layar });
      const page = await ctx.newPage();
      for (const g of tanpaSesi) {
        await page.setViewportSize(UKURAN[g.lebar]);
        try {
          await jepret(page, g, "-");
          process.stdout.write(`  ✓ ${g.id}  (tanpa sesi, ${g.lebar})\n`);
        } catch (e) {
          gagal.push(`${g.id}: ${e instanceof Error ? e.message : String(e)}`);
          process.stdout.write(`  ✗ ${g.id}  ${e instanceof Error ? e.message : e}\n`);
        }
      }
      await ctx.close();
    }

    const peranUnik = [...new Set(daftar.filter((g) => !g.tanpaSesi).map((g) => g.peran))];
    for (const peran of peranUnik) {
      const ctx = await browser.newContext({ viewport: UKURAN.layar });
      const page = await ctx.newPage();
      await masuk(page, peran);
      const lokasi = await contohLokasi(page);

      for (const g of daftar.filter((x) => x.peran === peran && !x.tanpaSesi)) {
        await page.setViewportSize(UKURAN[g.lebar]);
        try {
          await jepret(page, g, lokasi);
          process.stdout.write(`  ✓ ${g.id}  (${peran}, ${g.lebar})\n`);
        } catch (e) {
          gagal.push(`${g.id}: ${e instanceof Error ? e.message : String(e)}`);
          process.stdout.write(`  ✗ ${g.id}  ${e instanceof Error ? e.message : e}\n`);
        }
      }
      await ctx.close();
    }
  } finally {
    await browser?.close();
  }

  // Manifes dipakai `bangun.ts` untuk mencocokkan naskah dengan gambar yang
  // BENAR-BENAR ada, dan untuk menulis keterangan di bawah tiap gambar.
  await writeFile(
    path.join(KELUARAN, "manifes.json"),
    `${JSON.stringify(
      SEMUA_GAMBAR.map(({ id, keterangan, peran, lebar }) => ({ id, keterangan, peran, lebar })),
      null,
      2,
    )}\n`,
  );

  if (gagal.length) {
    process.stderr.write(`\n${gagal.length} gambar GAGAL:\n${gagal.map((g) => `  - ${g}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${daftar.length} gambar tersimpan di ${KELUARAN}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
