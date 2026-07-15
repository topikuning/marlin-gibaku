import { test, expect, type Page } from "@playwright/test";

/**
 * E2E auth + otorisasi dasar. Prasyarat: DB dev ter-seed (pnpm db:seed),
 * server jalan di baseURL. Password seed: marlin123.
 */

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  // Target input via role textbox: field password kini bersanding dgn tombol
  // show/hide (aria-label "Tampilkan password") → getByLabel("Password")
  // bentrok 2 elemen. Role "textbox" hanya cocok ke input, bukan tombol.
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  // Tunggu redirect action selesai (cookie sesi terpasang) sebelum navigasi berikutnya —
  // kecuali skenario gagal login yang tetap di /masuk.
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 10_000 }).catch(() => {});
}

test.describe("autentikasi", () => {
  test("tanpa sesi diarahkan ke /masuk", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/masuk/);
  });

  test("password salah ditolak dengan pesan", async ({ page }) => {
    await login(page, "admin", "password-salah");
    await expect(page.getByRole("alert").filter({ hasText: "salah" })).toBeVisible();
  });

  test("login admin → Command Center", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Halo, Administrator")).toBeVisible();
  });

  test("user mustChangePassword dipaksa ganti password", async ({ page }) => {
    await login(page, "sm-02");
    await expect(page).toHaveURL(/\/ganti-password/);
    await expect(page.getByText("ganti password bawaan", { exact: false })).toBeVisible();
  });

  test("keluar mengakhiri sesi", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL("/");
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/masuk/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/masuk/);
  });
});

test.describe("otorisasi per peran", () => {
  test("mandor tidak melihat menu Pengguna/Keuangan dan ditolak akses halaman", async ({ page }) => {
    await login(page, "mandor-01");
    await expect(page).toHaveURL("/");
    await expect(page.locator("nav").getByRole("link", { name: "Pengguna" })).toHaveCount(0);
    await page.goto("/pengguna");
    await expect(page.getByText(/404|not found/i).first()).toBeVisible();
  });

  test("exec viewer bisa lihat progress tapi tidak ada menu Sistem", async ({ page }) => {
    await login(page, "kkp-viewer");
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progress Portfolio" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Sistem" })).toHaveCount(0);
  });

  test("program director bisa buka Pengguna", async ({ page }) => {
    await login(page, "hery");
    await page.goto("/pengguna");
    await expect(page.getByText("Daftar pengguna").first()).toBeVisible();
  });
});
