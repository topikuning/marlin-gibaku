import { expect, test, type Page } from "@playwright/test";

/**
 * TOMBOL PASANG PWA DI DALAM MARLIN (DECISIONS 405).
 *
 * Permintaan user 2026-08-21: *"di chrome ada pilihan install. apakah kamu bisa
 * force memberi pilihan install tanpa harus masuk menu chrome untuk install"*
 *
 * ### Kenapa uji ini E2E, dan apa yang TIDAK dibuktikannya
 *
 * Aturan "kapan tawarannya pantas muncul" sudah diuji murni di
 * `tests/unit/pwa-pasang.test.ts`. Yang tidak bisa dibuktikan di sana adalah
 * RANGKAIANNYA: skrip penangkap di root layout → event kustom → komponen React
 * → `prompt()`. Dua cacat pada fitur ini hanya ketahuan di peramban:
 *
 *  1. tanpa skrip penangkap awal, event Chrome lewat sebelum React memasang
 *     pendengarnya dan tombolnya tidak pernah terbit;
 *  2. varian ringkas sempat membaca `window` langsung saat render — nilainya
 *     benar, tapi React tidak melacaknya, jadi tombolnya tidak pernah muncul.
 *
 * Yang TIDAK dibuktikan di sini: bahwa Chrome sungguhan menembakkan
 * `beforeinstallprompt`. Itu keputusan peramban atas syarat pasang (HTTPS,
 * manifest, ikon, service worker) dan tidak bisa dipicu dari uji. Event-nya
 * DITIRU — jadi yang dijaga adalah bagian yang memang milik kita.
 */

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Tiru `beforeinstallprompt` seperti yang dikirim Chrome Android. */
async function tawarkan(page: Page, hasil: "accepted" | "dismissed" = "accepted") {
  await page.evaluate((outcome) => {
    const w = window as unknown as { __dipanggil?: number };
    w.__dipanggil = 0;
    const e = new Event("beforeinstallprompt") as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: string }>;
    };
    e.prompt = () => {
      w.__dipanggil = (w.__dipanggil ?? 0) + 1;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, hasil);
}

const banner = (page: Page) => page.getByText("Pasang MARLIN di layar depan HP");
const tombolRingkas = (page: Page) =>
  page.getByRole("button", { name: "Pasang MARLIN di layar depan" });

test.describe("tawaran pasang aplikasi", () => {
  test("tidak menawarkan apa-apa bila peramban tidak menawarkan", async ({ page }) => {
    /*
     * Sisi ini yang membuat sisanya berarti. Banner pasang yang muncul di
     * peramban yang tidak bisa memasang adalah janji kosong – dan tombol yang
     * ditekan lalu tidak terjadi apa-apa merusak kepercayaan pada SEMUA tombol.
     */
    await login(page);
    await page.waitForTimeout(1500);
    await expect(banner(page)).toHaveCount(0);
    await expect(tombolRingkas(page)).toHaveCount(0);
  });

  test("Chrome menawarkan → banner terbit dan tombolnya memanggil pemasang", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1200);
    await tawarkan(page);

    await expect(banner(page)).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /Pasang sekarang|Membuka pemasang/ }).click();

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __dipanggil: number }).__dipanggil))
      .toBe(1);
    // Sesudah dipasang, tidak ada lagi yang perlu ditawarkan.
    await expect(banner(page)).toHaveCount(0);
  });

  test("ditutup → banner diam, tapi TOMBOL RINGKAS tetap ada", async ({ page }) => {
    /*
     * Lubang yang sempat saya buat sendiri: menutup banner sekali berarti dua
     * minggu tanpa satu pun jalan pasang di dalam MARLIN — persis kembali ke
     * menu ⋮ peramban yang justru dikeluhkan user.
     */
    await login(page);
    await page.waitForTimeout(1200);
    await tawarkan(page, "dismissed");
    await expect(banner(page)).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Tutup tawaran pasang" }).click();
    await expect(banner(page)).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await tawarkan(page);

    await expect(banner(page)).toHaveCount(0);
    await expect(tombolRingkas(page)).toBeVisible({ timeout: 5_000 });
    await tombolRingkas(page).click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __dipanggil: number }).__dipanggil))
      .toBe(1);
  });
});
