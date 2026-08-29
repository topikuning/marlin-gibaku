import { test, expect, type Page } from "@playwright/test";

/**
 * RAPL-07 (DECISIONS 470): biaya, harga satuan, dan MARGIN hanya untuk pemegang
 * `finance.view`.
 *
 * Yang dijaga bukan kerapian menu. `/lokasi/[slug]/rapl` dulu hanya dijaga
 * `rab.view`, dan `rab.view` dimiliki KEDELAPAN role — termasuk `wakil_ppk`,
 * verifikator dari pihak PEMBERI KERJA. Artinya lawan bicara pelaksana saat
 * negosiasi dan pemeriksaan termin bisa membuka, membaca, dan mencetak
 * perkiraan biaya internal beserta marginnya.
 *
 * Diuji dari titik masuk yang dipakai orang (blind spot §5 CARA_KERJA_AGEN):
 * halaman, lembar cetak, dan berkas unduhan — bukan dari fungsi `can()`, yang
 * hijau baik sebelum maupun sesudah perbaikan.
 *
 * Prasyarat: `pnpm db:seed`. `wakil-ppk-01` ditugaskan ke lokasi `kedungmutih`,
 * jadi ia LOLOS pemeriksaan akses lokasi — yang menahannya harus kapabilitas.
 */

const SLUG = "kedungmutih";

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 10_000 }).catch(() => {});
}

test.describe("RAPL: uang tertutup dari yang tidak berhak", () => {
  test("wakil PPK tidak melihat margin maupun biaya RAPL", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    await page.goto(`/lokasi/${SLUG}/rapl`);

    // Halamannya TETAP boleh dibuka — breakdown kebutuhan bagian dari memahami
    // pekerjaan. Yang hilang khusus angka uangnya.
    await expect(page.getByText("Breakdown kebutuhan")).toBeVisible();

    await expect(page.getByText("Potensi margin")).toHaveCount(0);
    await expect(page.getByText("Selisih sementara")).toHaveCount(0);
    await expect(page.getByText("Biaya RAPL")).toHaveCount(0);
    await expect(page.getByText("Harga terisi")).toHaveCount(0);
  });

  test("subtab Kebutuhan & harga tidak ada, dan alamatnya bukan pintu belakang", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    await page.goto(`/lokasi/${SLUG}/rapl`);
    await expect(page.getByRole("link", { name: /Kebutuhan & harga|Harga/ })).toHaveCount(0);

    // Mengetik alamatnya langsung dikembalikan ke Ringkasan, bukan disajikan.
    await page.goto(`/lokasi/${SLUG}/rapl?bagian=kebutuhan`);
    await expect(page.getByText("Harga satuan")).toHaveCount(0);
    await expect(page.getByText("Biaya RAPL")).toHaveCount(0);
  });

  test("lembar cetak RAPL tidak bisa dibuka wakil PPK", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    const res = await page.goto(`/cetak/rapl/${SLUG}`);
    expect(res?.status()).toBe(404);
  });

  test("unduhan Excel kebutuhan ditolak untuk wakil PPK", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    const res = await page.request.get(`/lokasi/${SLUG}/rapl/kebutuhan`);
    expect(res.status()).toBe(403);
  });

  test("mandor pun tidak melihat margin", async ({ page }) => {
    await login(page, "mandor-01");
    await page.goto(`/lokasi/${SLUG}/rapl`);
    await expect(page.getByText("Potensi margin")).toHaveCount(0);
    await expect(page.getByText("Selisih sementara")).toHaveCount(0);
  });

  test("super admin tetap melihat seluruhnya", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`/lokasi/${SLUG}/rapl`);
    await expect(page.getByText("Harga terisi")).toBeVisible();
    await expect(page.getByRole("link", { name: /Kebutuhan & harga|Harga/ }).first()).toBeVisible();
  });
});
