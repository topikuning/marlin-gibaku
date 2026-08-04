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

  test("login admin → Dashboard Eksekutif", async ({ page }) => {
    // Peran manajemen (punya portfolio.view) mendarat di Dashboard Eksekutif,
    // bukan Command Center. Peran lapangan tetap Command Center (lihat uji mandor).
    await login(page, "admin");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Dashboard Eksekutif" })).toBeVisible();
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
    // Pelaksana (field_supervisor) mendarat langsung di Hari Ini, bukan Beranda.
    await expect(page).toHaveURL("/hari-ini");
    await expect(page.locator("nav").getByRole("link", { name: "Pengguna" })).toHaveCount(0);
    await page.goto("/master/pengguna");
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
    await page.goto("/master/pengguna");
    await expect(page.getByText("Daftar pengguna").first()).toBeVisible();
  });
});

/**
 * URL lama harus tetap mendarat di tempat yang benar (DECISIONS 250).
 *
 * Alias ini dulu berupa `page.tsx` yang memanggil `redirect()`; sekarang entri
 * `redirects()` di next.config.ts yang ditangani sebelum React jalan. Pindah
 * lapisan seperti itu persis jenis perubahan yang diam-diam mematikan bookmark
 * lama — jadi diuji, bukan diasumsikan.
 */
test.describe("alias URL lama", () => {
  const ALIAS: { dari: string; ke: RegExp }[] = [
    { dari: "/aktivitas", ke: /\/$/ },
    { dari: "/pengguna", ke: /\/master\/pengguna$/ },
    { dari: "/paket/vendor", ke: /\/master\/perusahaan$/ },
    { dari: "/kontak-wa", ke: /\/master\/kontak$/ },
    { dari: "/laporan-wa", ke: /\/ai\/reports\?template=wa_update$/ },
  ];

  for (const { dari, ke } of ALIAS) {
    test(`${dari} mengalihkan ke tujuan kanoniknya`, async ({ page }) => {
      await login(page, "hery");
      await page.goto(dari);
      await expect(page).toHaveURL(ke);
    });
  }
});
