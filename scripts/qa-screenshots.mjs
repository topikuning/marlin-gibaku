// Visual QA: screenshot halaman kunci desktop + mobile → artifacts/rebuild/screenshots
import { chromium, devices } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = "artifacts/rebuild/screenshots";
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB approx

async function login(page, username) {
  await page.goto(`${BASE}/masuk`);
  await page.getByLabel("Username atau email").fill(username);
  await page.getByLabel("Password").fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"));
}

async function snap(page, path, name, dir) {
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
  const status = resp ? resp.status() : "ERR";
  await page.screenshot({ path: `${OUT}/${dir}/${name}.png`, fullPage: true });
  console.log(`${dir}/${name}: ${status} ${path}`);
  if (status !== 200) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });

// Desktop — admin
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, "admin");
  await snap(page, "/", "01-command-center", "desktop");
  await snap(page, "/paket", "02-paket-list", "desktop");
  const paketLink = await page.locator('a[href^="/paket/"]').first().getAttribute("href");
  if (paketLink && !paketLink.includes("baru")) {
    await snap(page, paketLink, "03-paket-workspace", "desktop");
    await snap(page, `${paketLink}/kontrak`, "04-paket-kontrak", "desktop");
  }
  await snap(page, "/lokasi", "05-lokasi-list", "desktop");
  await snap(page, "/lokasi/kedungmutih", "06-lokasi-ringkasan", "desktop");
  await snap(page, "/lokasi/kedungmutih/rab", "07-lokasi-rab", "desktop");
  await snap(page, `/lokasi/kedungmutih/harian/${today}`, "08-harian-workspace", "desktop");
  await snap(page, "/lokasi/kedungmutih/progress", "09-lokasi-progress", "desktop");
  await snap(page, "/lokasi/kedungmutih/keuangan", "10-lokasi-keuangan", "desktop");
  await snap(page, "/lokasi/kedungmutih/dokumen", "11-lokasi-dokumen-kepatuhan", "desktop");
  await snap(page, "/lokasi/kedungmutih/laporan-lokasi", "12-laporan-lokasi", "desktop");
  await snap(page, "/progress", "13-progress-portfolio", "desktop");
  await snap(page, "/keuangan", "14-keuangan-portfolio", "desktop");
  await snap(page, "/dokumen", "15-document-center", "desktop");
  await snap(page, "/laporan", "16-pusat-laporan", "desktop");
  await snap(page, "/pengguna", "17-pengguna", "desktop");
  await snap(page, "/sistem", "18-sistem", "desktop");
  // cetak: cari laporan final kedungmutih (4 hari lalu saat seed)
  const finalDate = new Date(Date.now() - 4 * 86400e3 + 7 * 3600e3).toISOString().slice(0, 10);
  await snap(page, `/cetak/harian/kedungmutih/${finalDate}`, "19-cetak-kkp-harian", "desktop");
  await ctx.close();
}

// Mobile — mandor
{
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await login(page, "mandor-01");
  await snap(page, "/hari-ini", "01-hari-ini", "mobile");
  await snap(page, `/lokasi/kedungmutih/harian/${today}`, "02-lapor-harian", "mobile");
  await snap(page, "/lokasi/kedungmutih", "03-lokasi-ringkasan", "mobile");
  await snap(page, "/", "04-beranda", "mobile");
  await ctx.close();
}

await browser.close();
console.log("selesai");
