import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });

await p.goto("http://localhost:3000/masuk");
await p.getByLabel("Username atau email").fill("admin");
await p.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
await p.getByRole("button", { name: "Masuk" }).click();
await p.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 30000 });

await p.goto("http://localhost:3000/lokasi/kedungmutih/harian", { waitUntil: "networkidle" });

// Gulir ke baris kalender paling bawah, seperti yang dilakukan user.
const petak = p.locator('[aria-label="Petak tanggal"] a');
const n = await petak.count();
console.log("jumlah petak tanggal:", n);
const target = petak.nth(Math.max(0, n - 3));
await target.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);

const sebelum = await p.evaluate(() => window.scrollY);
const kotakSebelum = await target.boundingBox();
await target.click();
await p.waitForTimeout(1200);
const sesudah = await p.evaluate(() => window.scrollY);

console.log(JSON.stringify({
  scrollY_sebelum_klik: Math.round(sebelum),
  scrollY_sesudah_klik: Math.round(sesudah),
  loncat_ke_atas: Math.round(sebelum - sesudah),
  posisi_petak_sebelum_y: kotakSebelum ? Math.round(kotakSebelum.y) : null,
  url: p.url(),
}, null, 2));
await b.close();
