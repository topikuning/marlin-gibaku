import { test, expect, type Page } from "@playwright/test";

/**
 * WORKSPACE PAKET SESUDAH ROMBAK (DECISIONS 386) – dibuktikan di browser.
 *
 * Rombakan itu memindahkan form yang jarang disentuh ke balik `Drawer`. Yang
 * membuat pemindahan itu boleh bukan kerapiannya, melainkan dua hal yang HANYA
 * bisa dibuktikan di peramban sungguhan:
 *
 *   1. isinya benar-benar bisa dibuka lagi – form yang tersembunyi dan tidak
 *      bisa dibuka sama saja dengan form yang dihapus;
 *   2. penutupnya bekerja (Escape, tombol tutup, klik latar), karena panel
 *      modal yang tidak bisa ditutup mengunci seluruh halaman.
 *
 * Ditambah satu hal yang jadi inti rombakan: keadaan tiap integrasi terbaca
 * TANPA membuka apa pun.
 *
 * Prasyarat: DB dev ter-seed, server jalan di baseURL.
 */

async function login(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/**
 * Paket pertama yang terlihat di daftar – uji ini tidak bergantung isi seed.
 *
 * Pemilihnya menuntut UUID, bukan sekadar awalan `/paket/`: halaman daftar juga
 * memuat tautan navigasi (`/paket/baru`, `/paket/bypass`, `/paket/katalog`),
 * dan versi pertama uji ini mendarat di `/paket/bypass` lalu menunggu URL yang
 * tidak akan pernah datang.
 */
async function daftarPaket(page: Page): Promise<string[]> {
  await page.goto("/paket");
  const kandidat = page.locator('a[href^="/paket/"]');
  await expect(kandidat.first()).toBeVisible({ timeout: 15_000 });
  const href = await kandidat.evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
  const unik = [...new Set(href.filter((h) => /^\/paket\/[0-9a-f-]{36}$/.test(h)))];
  if (unik.length === 0) throw new Error("Tidak ada paket di daftar – seed dev belum dijalankan?");
  return unik;
}

async function bukaPaketPertama(page: Page) {
  const [pertama] = await daftarPaket(page);
  await page.goto(pertama);
  await expect(page.getByRole("link", { name: "Ringkasan" })).toBeVisible({ timeout: 15_000 });
}

test.describe("workspace paket – panel geser", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await bukaPaketPertama(page);
  });

  test("keadaan integrasi terbaca tanpa membuka form apa pun", async ({ page }) => {
    // `section` tanpa nama aksesibel BUKAN role "region", jadi kartunya dicari
    // sebagai elemen biasa – bukan landmark.
    const panel = page.locator("section").filter({ hasText: "Komunikasi paket" }).last();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Grup WhatsApp paket")).toBeVisible();
    // Lencananya salah satu dari dua – yang penting ADA, bukan nilainya, karena
    // isi seed boleh berubah tanpa membatalkan aturan ini.
    await expect(panel.getByText(/^(Terpasang|Belum)$/).first()).toBeVisible();
  });

  test("form grup WhatsApp masih bisa dibuka, dan panelnya bisa ditutup", async ({ page }) => {
    const pemicu = page.getByRole("button", { name: /Kelola koneksi|Tautkan grup/ }).first();
    await expect(pemicu).toBeVisible();
    await pemicu.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Grup WhatsApp paket")).toBeVisible();

    // Escape menutup; fokus kembali ke pemicunya (pola APG).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(pemicu).toBeFocused();

    // Dan bisa dibuka lagi — sekali buka bukan sekali seumur halaman.
    await pemicu.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Tutup panel" }).first().click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("banner selisih kontrak membawa jalan menuju rekonsiliasinya", async ({ page }) => {
    /*
     * Bannernya hanya muncul pada paket yang MEMANG berselisih, jadi seluruh
     * daftar ditelusuri sampai ketemu satu. Versi pertama uji ini hanya
     * memeriksa paket pertama, lalu melewatkan diri – dan uji yang selalu
     * melewatkan diri terbaca hijau tanpa pernah membuktikan apa pun.
     */
    for (const href of await daftarPaket(page)) {
      await page.goto(href);
      const tombol = page.getByRole("link", { name: "Periksa masalah" });
      if (!(await tombol.isVisible().catch(() => false))) continue;
      await tombol.click();
      await expect(page.locator("#rekonsiliasi")).toBeVisible();
      return;
    }
    /*
     * BUKAN `test.skip` (audit 2026-08-28, I-6). Seed menjamin paket pertama
     * bernilai kontrak 2% di atas RAB+PPN (`src/lib/seed/demo.ts`), jadi kalau
     * loop di atas tidak menemukan satu pun banner, yang rusak adalah jalur
     * peringatan selisihnya — dan itu harus MERAH, bukan dilewatkan.
     */
    throw new Error(
      "Tidak ada paket berselisih kontrak vs RAB. Seed menjamin ada satu; " +
        'berarti banner "Periksa masalah" tidak lagi muncul.',
    );
  });

  test("aksi cepat di kepala halaman menuju tab yang benar", async ({ page }) => {
    await page.getByRole("link", { name: /\d+ Lokasi/ }).click();
    await page.waitForURL(/\/paket\/[0-9a-f-]{36}\/lokasi/, { timeout: 15_000 });
    await expect(page.getByText("Lokasi paket").first()).toBeVisible();
  });
});
