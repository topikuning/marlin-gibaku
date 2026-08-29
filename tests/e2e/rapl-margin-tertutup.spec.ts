import { test, expect, type Page } from "@playwright/test";

/**
 * RAPL-07 (DECISIONS 473): biaya, harga satuan, dan MARGIN hanya untuk pemegang
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
 * ### Kenapa selectornya seketat ini
 *
 * Versi pertama memakai `page.getByText("Potensi margin")` dan gagal 6 kali di
 * CI. Bukan karena penjaganya bocor — justru sebaliknya. `getByText` dengan
 * string mencocokkan SUBSTRING dan MENGABAIKAN besar-kecil huruf, sehingga ia
 * menjaring kalimat penjelas halaman itu sendiri: banner "…Harga satuan, biaya
 * pelaksanaan, dan potensi margin hanya untuk pengguna berhak akses keuangan",
 * yang justru hanya muncul ketika `finance.view` TIDAK ada.
 *
 * Jadi uji ini sekarang: `exact: true` untuk label KPI (cocok utuh dan peka
 * huruf besar), dan `href` untuk subtab — bukan teks tautan, yang berganti
 * antara layar lebar ("Kebutuhan & harga") dan sempit ("Harga").
 *
 * Prasyarat: `pnpm db:seed`. `wakil-ppk-01` dan `mandor-01` sama-sama
 * ditugaskan ke `kedungmutih`, jadi keduanya LOLOS pemeriksaan akses lokasi —
 * yang menahan mereka harus kapabilitas, bukan penugasan.
 */

const SLUG = "kedungmutih";

/** Kalimat yang HANYA dirender saat angka uang ditahan. Bukti positifnya. */
const BANNER_DITAHAN = "Biaya dan margin tidak ditampilkan untuk peranmu";

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 10_000 }).catch(() => {});
}

/** Tidak ada satu pun label uang di layar. */
async function tanpaAngkaUang(page: Page) {
  for (const label of [
    "Potensi margin",
    "Selisih sementara",
    "Biaya RAPL",
    "Harga terisi",
    "Harga satuan",
  ]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
}

test.describe("RAPL: uang tertutup dari yang tidak berhak", () => {
  test("wakil PPK tidak melihat margin maupun biaya RAPL", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    await page.goto(`/lokasi/${SLUG}/rapl`);

    // Halamannya TETAP boleh dibuka — breakdown kebutuhan bagian dari memahami
    // pekerjaan. Yang hilang khusus angka uangnya.
    await expect(page.getByText("Breakdown kebutuhan", { exact: true })).toBeVisible();
    await expect(page.getByText(BANNER_DITAHAN)).toBeVisible();

    await tanpaAngkaUang(page);
  });

  test("subtab uang tidak ada, dan alamatnya bukan pintu belakang", async ({ page }) => {
    await login(page, "wakil-ppk-01");
    await page.goto(`/lokasi/${SLUG}/rapl`);

    // Dicek lewat href, bukan teks: label subtab berganti di layar sempit.
    await expect(page.locator('a[href*="bagian=kebutuhan"]')).toHaveCount(0);
    await expect(page.locator('a[href*="bagian=rincian"]')).toHaveCount(0);

    // Mengetik alamatnya langsung dikembalikan ke Ringkasan, bukan disajikan.
    await page.goto(`/lokasi/${SLUG}/rapl?bagian=kebutuhan`);
    await expect(page.getByText(BANNER_DITAHAN)).toBeVisible();
    await tanpaAngkaUang(page);

    await page.goto(`/lokasi/${SLUG}/rapl?bagian=rincian`);
    await expect(page.getByText(BANNER_DITAHAN)).toBeVisible();
    await tanpaAngkaUang(page);
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
    await expect(page.getByText(BANNER_DITAHAN)).toBeVisible();
    await tanpaAngkaUang(page);
  });

  test("super admin tetap melihat seluruhnya", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`/lokasi/${SLUG}/rapl`);

    await expect(page.getByText(BANNER_DITAHAN)).toHaveCount(0);
    await expect(page.getByText("Harga terisi", { exact: true })).toBeVisible();
    await expect(page.locator('a[href*="bagian=kebutuhan"]').first()).toBeVisible();
    await expect(page.locator('a[href*="bagian=rincian"]').first()).toBeVisible();
  });
});
