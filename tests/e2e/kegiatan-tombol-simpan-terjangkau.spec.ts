import { test, expect, type Page } from "@playwright/test";

/**
 * TOMBOL SIMPAN HARUS SELALU TERJANGKAU.
 *
 * Keluhan user 2026-09-03: *"tombol tidak bisa discroll, tertutup seperti itu"*.
 * Kolom form kegiatan dipaku (`lg:sticky`) supaya tetap terlihat saat riwayat
 * digulir, tapi tanpa batas tinggi kolom yang lebih tinggi dari layar tidak
 * bisa digulir sama sekali: bagian atasnya terpaku, dan "Simpan kegiatan" di
 * dasarnya menggantung di luar layar — form yang tidak bisa dikirim.
 *
 * Diuji dari LAYAR pada lebar desktop (di sanalah `lg:` berlaku), bukan dari
 * kelas CSS di berkas sumber: kelas yang benar pun bisa dikalahkan tinggi
 * induk atau `overflow` lain (blind spot §5 CARA_KERJA_AGEN).
 *
 * Prasyarat: `pnpm db:seed`.
 */

async function login(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

test.describe("form kegiatan lapangan", () => {
  test("tombol Simpan kegiatan tetap terjangkau, termasuk saat halaman digulir", async ({
    page,
    viewport,
  }) => {
    // Kolom paku hanya berlaku dari lebar `lg` ke atas.
    test.skip((viewport?.width ?? 0) < 1024, "kolom paku hanya pada lebar desktop");

    await login(page, "admin");
    await page.goto("/lokasi");
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".ag-row").first().click();
    await page.waitForURL(/\/lokasi\/[^/]+$/, { timeout: 15_000 });
    await page.goto(`${new URL(page.url()).pathname}/kegiatan`);

    const simpan = page.getByRole("button", { name: "Simpan kegiatan" });
    if ((await simpan.count()) === 0) test.skip(true, "akun ini tidak boleh mencatat kegiatan");

    // Yang diuji adalah KETERJANGKAUAN, bukan "terlihat tanpa menggulir":
    // tombol di dasar form memang wajar berada di bawah lipatan saat halaman
    // baru dibuka. Yang tidak wajar — dan itulah bugnya — adalah menggulir pun
    // tak pernah membawanya ke layar, karena kolomnya terpaku tanpa batas
    // tinggi sehingga isinya tidak ikut bergulir ke mana-mana.
    await simpan.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await expect(simpan).toBeInViewport();

    // Tetap terjangkau juga setelah halaman digulir sampai habis.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await simpan.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await expect(simpan).toBeInViewport();
  });
});
