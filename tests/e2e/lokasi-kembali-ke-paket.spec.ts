import { expect, test, type Page } from "@playwright/test";

/**
 * DI PONSEL, DARI LOKASI HARUS ADA JALAN KEMBALI KE PAKETNYA.
 *
 * Keluhan user 2026-10-17: *"terkait navigasi lokasi, di HP, saat masuk lokasi,
 * sulit untuk kembali ke halaman paket"*. Tautan paket hanya ada di header
 * desktop, dan header itu disembunyikan di ponsel (`max-sm:hidden`), jadi di
 * layar sempit tidak ada satu pun jalan ke atas.
 *
 * Harus E2E: yang menentukan adalah apa yang TERLIHAT pada lebar ponsel, bukan
 * apakah tautannya ada di DOM (versi desktopnya ada, hanya tersembunyi).
 */

const LOKASI = "kedungmutih";

async function login(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

test.describe("lokasi di ponsel: kembali ke paket", () => {
  test("tautan paket terlihat di layar sempit dan membawa ke halaman paket", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "hery");
    // Dari tab lain, bukan Ringkasan: justru di situ orang paling jauh dari paketnya.
    await page.goto(`/lokasi/${LOKASI}/progress`);

    const kembali = page.getByRole("link", { name: /^Paket / }).filter({ visible: true });
    await expect(kembali).toHaveCount(1, { timeout: 30_000 });
    await kembali.click();
    await expect(page).toHaveURL(/\/paket\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  });

  test("Pelaksana tidak diberi tautan ke paket yang tidak boleh ia buka", async ({ page }) => {
    // Halaman paket dijaga `package.view`; Pelaksana tidak memegangnya.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "mandor-01");
    await page.goto(`/lokasi/${LOKASI}`);
    await expect(page.getByRole("tab", { name: "Ringkasan" }).or(page.getByRole("link", { name: "Ringkasan" })).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(`a[href^="/paket/"]`)).toHaveCount(0);
  });
});
