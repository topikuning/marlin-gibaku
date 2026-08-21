import { test, expect, type Page } from "@playwright/test";

/**
 * APLIKASINYA SENDIRI HARUS BISA DIBUKA TANPA SINYAL (DECISIONS 392).
 *
 * DECISIONS 257 menyelamatkan foto yang SUDAH dijepret: ia bertahan melewati
 * muat ulang, tab tertutup, dan HP dimatikan. Yang tersisa – dan ditulis
 * terang-terangan sebagai batas waktu itu – adalah halamannya sendiri: tanpa
 * service worker, `/foto-cepat` tidak bisa DIBUKA dari nol saat benar-benar
 * offline. Mandor yang HP-nya baru menyala di luar jangkauan tidak bisa
 * memotret sama sekali, dan buktinya hilang bukan karena sistemnya gagal
 * melainkan karena halamannya tak pernah muncul.
 *
 * Berkas ini menjaga tiga janji, tidak lebih:
 *   1. `/foto-cepat` terbuka saat offline;
 *   2. halaman itu MENGAKU dirinya simpanan, bukan pura-pura segar;
 *   3. halaman lain yang offline berkata "tidak ada jaringan" dengan jujur,
 *      bukan layar galat peramban.
 *
 * Service worker hanya didaftarkan di production build (di dev ia mengecoh HMR),
 * jadi uji ini berjalan lewat `pnpm start` seperti seluruh suite e2e.
 */

async function masuk(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
}

/** Tunggu sampai service worker benar-benar MENGENDALIKAN halaman ini. */
async function tungguDikendalikan(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 30_000,
  });
}

test.describe("PWA – aplikasi terbuka tanpa jaringan", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "alur lapangan = ponsel");
    await masuk(page);
  });

  test("/foto-cepat terbuka saat OFFLINE dan mengaku dari simpanan", async ({ page, context }) => {
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await tungguDikendalikan(page);

    // Kunjungan PERTAMA yang lewat service worker-lah yang tersimpan: saat
    // muat pertama tadi, pemasangnya belum mengendalikan halaman.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible();

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    // Inti janji: halamannya MUNCUL, bukan layar galat peramban.
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible({
      timeout: 20_000,
    });

    // Dan ia tidak berpura-pura segar. Data lokasi/kantong di halaman ini
    // berasal dari kunjungan terakhir; menyembunyikan itu berarti membiarkan
    // orang mengira daftarnya mutakhir.
    await expect(page.getByText("Ditampilkan dari simpanan HP ini")).toBeVisible({
      timeout: 20_000,
    });

    await context.setOffline(false);
  });

  test("halaman lain saat OFFLINE menjawab jujur, bukan layar galat peramban", async ({
    page,
    context,
  }) => {
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await tungguDikendalikan(page);

    await context.setOffline(true);
    await page.goto("/progress", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Tidak ada jaringan" })).toBeVisible({
      timeout: 20_000,
    });
    // Kalimat yang paling penting di halaman itu: fotonya tidak hilang.
    await expect(page.getByText(/terkirim sendiri begitu sinyal kembali/i)).toBeVisible();

    await context.setOffline(false);
  });
});
