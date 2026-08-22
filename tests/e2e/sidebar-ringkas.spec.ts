import { expect, test, type Page } from "@playwright/test";

/**
 * SIDEBAR BISA DIRINGKAS (DECISIONS 413).
 *
 * Permintaan user 2026-08-22: *"sidebar yang bisa di collapsible, jadi bisa
 * memperlebar pandangan di desktop"*, lalu *"tidak perlu ramping, collapsible
 * saja."*
 *
 * ### Kenapa E2E
 *
 * Aturan bacaan nilainya sudah diuji murni di `tests/unit/sidebar-ringkas.test.ts`.
 * Yang tidak bisa dibuktikan di sana ada tiga, dan ketiganya justru inti
 * permintaannya:
 *
 *  1. lebar sidebar DAN bantalan kiri konten menyempit BERSAMA — kalau cuma
 *     salah satunya, hasilnya bukan layar yang lebih lega melainkan pita
 *     kosong selebar 15rem;
 *  2. pilihannya diingat sesudah muat ulang — tanpa itu tombolnya cuma mainan;
 *  3. lebar TERBENTANG-nya tidak berubah sama sekali (user: "tidak perlu
 *     ramping").
 */

const LEBAR_TERBENTANG = 240; // w-60
const LEBAR_RINGKAS = 64; // 4rem

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Lebar sidebar + bantalan kiri konten, diukur bersama. */
async function ukur(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector("aside.marlin-sidebar");
    const konten = document.querySelector(".marlin-konten");
    return {
      sidebar: aside ? Math.round(aside.getBoundingClientRect().width) : -1,
      bantalan: konten ? Math.round(parseFloat(getComputedStyle(konten).paddingLeft)) : -1,
    };
  });
}

const tombol = (page: Page) =>
  page.getByRole("button", { name: /Ringkas menu samping|Bentangkan menu samping/ });

test.describe("sidebar bisa diringkas", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("sidebar DAN bantalan konten menyempit bersama", async ({ page }) => {
    await login(page);
    await expect(tombol(page)).toBeVisible({ timeout: 30_000 });

    // Keadaan awal: lebar bawaan, tidak berubah oleh fitur ini.
    expect(await ukur(page)).toEqual({ sidebar: LEBAR_TERBENTANG, bantalan: LEBAR_TERBENTANG });

    await tombol(page).click();
    /*
     * Inti gunanya. Kalau cuma sidebarnya yang menyempit, yang didapat bukan
     * layar lebih lega melainkan pita kosong selebar 15rem di kiri konten.
     */
    await expect.poll(async () => (await ukur(page)).sidebar).toBe(LEBAR_RINGKAS);
    expect((await ukur(page)).bantalan).toBe(LEBAR_RINGKAS);

    // Dan kembali lagi – penyempitannya bukan jalan satu arah.
    await tombol(page).click();
    await expect.poll(async () => (await ukur(page)).sidebar).toBe(LEBAR_TERBENTANG);
    expect((await ukur(page)).bantalan).toBe(LEBAR_TERBENTANG);
  });

  test("pilihannya diingat sesudah muat ulang, tanpa berkedip", async ({ page }) => {
    await login(page);
    await expect(tombol(page)).toBeVisible({ timeout: 30_000 });
    await tombol(page).click();
    await expect.poll(async () => (await ukur(page)).sidebar).toBe(LEBAR_RINGKAS);

    await page.reload({ waitUntil: "domcontentloaded" });
    /*
     * Diukur SEBELUM menunggu apa pun: atributnya dipasang skrip pra-lukis di
     * <head>, jadi lebarnya harus sudah benar pada lukisan pertama. Kalau ia
     * baru benar sesudah React hidup, ukuran di sini masih 240 — dan itulah
     * kedipan yang dikeluhkan orang di setiap perpindahan halaman.
     */
    expect(await ukur(page)).toEqual({ sidebar: LEBAR_RINGKAS, bantalan: LEBAR_RINGKAS });

    // Pindah halaman (bukan muat ulang) juga tetap ringkas.
    await page.goto("/lokasi");
    expect((await ukur(page)).sidebar).toBe(LEBAR_RINGKAS);

    // Dikembalikan supaya uji lain tidak mewarisi keadaan ini.
    await tombol(page).click();
    await expect.poll(async () => (await ukur(page)).sidebar).toBe(LEBAR_TERBENTANG);
  });

  test("selagi ringkas, menunya masih punya NAMA – bukan ikon tanpa identitas", async ({ page }) => {
    /*
     * Labelnya disembunyikan CSS. Kalau nama menunya ikut hilang dari pohon
     * aksesibilitas, yang tersisa buat pembaca layar cuma "link" berkali-kali —
     * dan orang yang memakai perbesaran layar kehilangan satu-satunya petunjuk
     * saat ikonnya tidak terbaca.
     */
    await login(page);
    await expect(tombol(page)).toBeVisible({ timeout: 30_000 });
    await tombol(page).click();
    await expect.poll(async () => (await ukur(page)).sidebar).toBe(LEBAR_RINGKAS);

    const beranda = page.locator("aside.marlin-sidebar").getByRole("link", { name: "Beranda" });
    await expect(beranda).toBeVisible();
    await expect(beranda).toHaveAttribute("title", "Beranda");

    await tombol(page).click();
  });

  test("di ponsel tidak ada tombolnya sama sekali", async ({ page }) => {
    // Sidebarnya memang tidak ada di bawah lg (nav bawah + laci). Meringkas
    // sesuatu yang tidak tampak cuma menghasilkan bug yang tidak bersuara.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/lokasi");
    await expect(tombol(page)).toBeHidden();
  });
});
