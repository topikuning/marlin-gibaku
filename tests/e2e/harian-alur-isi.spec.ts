import { test, expect, type Page } from "@playwright/test";

/**
 * ALUR ISI CEPAT LAPORAN HARIAN (DECISIONS 226).
 *
 * Permintaan user 2026-08-02: buka → fokus kolom pekerjaan · pilih pekerjaan →
 * fokus kolom volume · simpan → fokus balik ke kolom pekerjaan. Plus: pekerjaan
 * yang tersimpan tanpa foto harus punya jalan menambah foto MENYUSUL.
 *
 * Diuji lewat browser sungguhan karena yang diuji adalah fokus — tidak ada cara
 * lain membuktikannya. Prasyarat: DB dev ter-seed, server jalan di baseURL.
 */

const SLUG = process.env.E2E_SLUG ?? "kedungmutih";

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Tanggal kerja hari ini di Asia/Jakarta — sama dengan yang dipakai server. */
function hariIniJakarta() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

async function bukaEditor(page: Page) {
  await login(page, "sm-01");
  await page.goto(`/lokasi/${SLUG}/harian/${hariIniJakarta()}`);
  await expect(page.getByRole("heading", { name: "Tambah / ubah progres pekerjaan" })).toBeVisible({
    timeout: 15_000,
  });
}

const idFokus = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");

test.describe("alur fokus isi cepat", () => {
  test("buka → pekerjaan, pilih → volume, simpan → pekerjaan lagi", async ({ page }) => {
    await bukaEditor(page);

    // 1 · dibuka → kolom pekerjaan
    await expect.poll(() => idFokus(page), { timeout: 5_000 }).toBe("dr-search");

    // 2 · pilih pekerjaan → kolom volume
    await page.getByPlaceholder("Ketik nama / kode pekerjaan").fill("galian");
    const opsi = page.locator("button", { hasText: /galian/i }).first();
    await expect(opsi).toBeVisible({ timeout: 10_000 });
    await opsi.click();
    await expect.poll(() => idFokus(page), { timeout: 5_000 }).toBe("dr-volume");

    // 3 · simpan → balik ke kolom pekerjaan
    await page.locator("#dr-volume").fill("1");
    await page.getByRole("button", { name: "Simpan Progres" }).click();
    await expect(page.getByText("Progres tersimpan.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => idFokus(page), { timeout: 5_000 }).toBe("dr-search");
  });
});

test.describe("kolom cari tidak pernah lepas dari DOM", () => {
  // Papan ketik ponsel hanya mau terbuka dari gestur pengguna. Kalau kolom cari
  // di-unmount saat pekerjaan terpilih, ketukan "Simpan Progres" tidak punya
  // elemen untuk difokuskan di dalam gestur itu — dan papan ketik tetap tertutup
  // sampai pelapor mengetuk sendiri. Itu keluhan nyata user 2026-08-02.
  test("kolom cari tetap ada saat pekerjaan sudah dipilih", async ({ page }) => {
    await bukaEditor(page);
    await page.getByPlaceholder("Ketik nama / kode pekerjaan").fill("galian");
    const opsi = page.locator("button", { hasText: /galian/i }).first();
    await expect(opsi).toBeVisible({ timeout: 10_000 });
    await opsi.click();
    // Pekerjaan terpilih (kartu muncul) TAPI kolom cari tetap terpasang.
    await expect(page.locator("#dr-search")).toHaveCount(1);
    await expect(page.locator("#dr-search")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ganti" })).toBeVisible();
  });
});

test.describe("konfirmasi lokasi galeri = dialog, bukan catatan kaki", () => {
  test("dialog muncul dengan dua tombol besar, tanpa paragraf penjelasan", async ({ page }) => {
    await bukaEditor(page);
    const galeri = page.getByRole("button", { name: "Galeri" }).first();
    if ((await galeri.count()) === 0) {
      test.skip(true, "Penyimpanan foto (R2) tidak aktif di lingkungan ini.");
      return;
    }
    await galeri.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Kamu sedang di lokasi proyek?")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Ya, saya di lokasi/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Tidak", exact: true })).toBeVisible();
    // Penjelasan panjang yang dulu ada di situ sengaja dibuang.
    await expect(dialog.getByText("dipakai sebagai cadangan")).toHaveCount(0);
  });
});

test.describe("foto menyusul", () => {
  test('item tanpa foto ditandai "Belum ada foto" dan bisa ditambahi', async ({ page }) => {
    await bukaEditor(page);

    // Pastikan ada minimal satu item hari ini (uji ini berdiri sendiri).
    await page.getByPlaceholder("Ketik nama / kode pekerjaan").fill("galian");
    const opsi = page.locator("button", { hasText: /galian/i }).first();
    await expect(opsi).toBeVisible({ timeout: 10_000 });
    await opsi.click();
    await page.locator("#dr-volume").fill("1");
    await page.getByRole("button", { name: "Simpan Progres" }).click();
    await expect(page.getByText("Progres tersimpan.")).toBeVisible({ timeout: 20_000 });

    // Penandanya harus TERBACA, bukan cuma tombol: tanpa itu, foto yang
    // ketinggalan baru ketahuan setelah laporan telanjur dikirim.
    // (Kalau R2 belum aktif, unggah foto memang tidak tersedia — lewati.)
    const daftar = page.getByText(/Item hari ini \(/);
    await expect(daftar).toBeVisible({ timeout: 10_000 });
    const tombol = page.getByRole("button", { name: /Tambahkan foto|Tambah foto/ }).first();
    if ((await tombol.count()) === 0) {
      test.skip(true, "Penyimpanan foto (R2) tidak aktif di lingkungan ini.");
      return;
    }
    await expect(page.getByText("Belum ada foto").first()).toBeVisible();

    await tombol.click();
    await expect(
      page.getByText("Volume dan catatan yang sudah tersimpan tidak berubah.").first(),
    ).toBeVisible();
    // Tanpa berkas, aksi menolak dengan jelas — bukan diam-diam "berhasil".
    await page.getByRole("button", { name: "Simpan foto" }).click();
    await expect(page.getByText("Belum ada foto yang dipilih.")).toBeVisible({ timeout: 15_000 });
  });
});
