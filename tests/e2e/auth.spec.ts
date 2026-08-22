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
    await page.goto("/pengguna");
    await expect(page.getByText(/404|not found/i).first()).toBeVisible();
  });

  test("Keuangan DITAHAN: hanya super admin, dan pintunya ikut tertutup", async ({ page }) => {
    /*
     * Permintaan user 2026-08-22: *"menu keuangan saat ini belum siap, jadi
     * selain superadmin, tidak usah ditampilkan dulu"* (DECISIONS 411).
     *
     * Yang diuji BUKAN cuma menunya hilang, tapi alamatnya ikut tertutup.
     * Menu yang disembunyikan sementara alamatnya terbuka adalah keadaan
     * paling buruk: yang menemukannya masuk tanpa menu, tanpa konteks, ke
     * fitur yang memang belum siap.
     */
    await login(page, "hery");
    await expect(page.locator("nav").getByRole("link", { name: "Keuangan" })).toHaveCount(0);
    await page.goto("/keuangan");
    await expect(page.getByText(/404|not found/i).first()).toBeVisible();
  });

  test("super admin TETAP bisa membuka Keuangan – penahanan bukan penghapusan", async ({ page }) => {
    // Sisi ini yang membuat uji di atas berarti. Kalau Keuangan hilang untuk
    // SEMUA orang, yang terjadi bukan penahanan melainkan fitur yang mati.
    await login(page, "admin");
    await page.goto("/keuangan");
    await expect(page.getByText(/404|not found/i)).toHaveCount(0);
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
    // Patokannya BUKAN judul kartu. Judul bisa berubah saat tata letak diganti
    // (dan memang berubah di DECISIONS 359), sementara yang sebenarnya diuji
    // di sini adalah izinnya: halamannya terbuka DAN daftarnya benar-benar
    // berisi. Ringkasan "Total akun" + satu baris akun nyata membuktikan
    // keduanya; menunggu judul hanya membuktikan halamannya tidak 404.
    await expect(page.getByText("Total akun").first()).toBeVisible();
    // `filter({ visible: true })`, bukan `.first()`. Daftarnya dirender dua
    // kali — tabel untuk layar lebar, kartu untuk ponsel — dan salah satunya
    // SELALU tersembunyi. `.first()` di ponsel menunjuk salinan tabel yang
    // memang tak terlihat, lalu gagal dengan alasan yang menyesatkan.
    await expect(page.getByText("@hery").filter({ visible: true }).first()).toBeVisible();
  });
});
