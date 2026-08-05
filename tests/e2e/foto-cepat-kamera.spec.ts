import { test, expect } from "@playwright/test";

/**
 * KAMERA DALAM APLIKASI — jepret, masuk, jepret lagi (DECISIONS 256).
 *
 * Keluhan user: *"ada konfirmasi use this photo, bukan jepret langsung simpan"*.
 *
 * Yang dijaga di sini adalah janji yang TIDAK bisa dibuktikan uji unit maupun
 * integrasi: bahwa rananya benar-benar ada di dalam halaman, bahwa satu ketukan
 * benar-benar mengirim satu foto, dan bahwa ketukan berikutnya tidak perlu
 * menunggu apa pun. Kalau suatu saat ini kembali memakai `<input capture>`,
 * layarnya tetap tampak normal — yang berubah cuma munculnya layar konfirmasi
 * milik sistem operasi, dan itu tidak akan tertangkap uji lain mana pun.
 *
 * Kamera palsu Chromium (`--use-fake-device-for-media-stream`) memberi aliran
 * video sintetis, jadi `getUserMedia` benar-benar dijalankan — bukan di-stub.
 */
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test.describe("Foto Cepat — rana di dalam aplikasi", () => {
  test.beforeEach(async ({ page, context }) => {
    test.skip(test.info().project.name !== "mobile", "alur lapangan = ponsel");
    await context.grantPermissions(["geolocation", "camera"]);
    await context.setGeolocation({ latitude: -6.87, longitude: 112.5 });
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  });

  test("satu ketukan rana = satu foto terkirim, tanpa layar konfirmasi", async ({ page }) => {
    /*
     * Server action = POST ber-header `next-action` ke URL halaman yang sama.
     * Yang dihitung headernya, BUKAN pathname-nya: pathname bisa berubah
     * (basePath, trailing slash) tanpa satu pun perilaku berubah, dan uji yang
     * patah karena itu akan dibaca sebagai fiturnya yang rusak.
     */
    const kiriman: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) kiriman.push(r.url());
    });

    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /buka kamera/i }).click();

    // Pratinjau harus benar-benar hidup — bukan sekadar elemen video kosong.
    const video = page.getByLabel("Pratinjau kamera");
    await expect(video).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);

    const rana = page.getByRole("button", { name: "Jepret" });
    await expect(rana).toBeEnabled({ timeout: 20_000 });
    // Dikosongkan TEPAT sebelum rana: halaman ini juga mencatat keadaan izin
    // perangkat lewat server action, jadi menghitung sejak awal akan mencampur
    // POST yang tidak ada hubungannya dengan memotret. (Sempat terjadi — dan
    // terbaca seolah rananya tidak mengirim apa pun.)
    kiriman.length = 0;
    await rana.click();

    // Foto masuk ke strip TANPA satu pun ketukan konfirmasi di antaranya.
    // Status apa pun boleh — yang dijanjikan adalah fotonya MASUK ke antrean
    // tanpa konfirmasi, bukan bahwa penyimpanannya berhasil (lingkungan uji bisa
    // saja belum punya penyimpanan foto).
    await expect(page.getByText(/aman|kirim…|gagal/).first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => kiriman.length, { message: "ketukan rana tidak mengirim apa pun", timeout: 20_000 })
      .toBe(1);
  });

  test("jepret beruntun: ketukan kedua tidak perlu menunggu yang pertama", async ({ page }) => {
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /buka kamera/i }).click();
    const video = page.getByLabel("Pratinjau kamera");
    await expect
      .poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);

    const rana = page.getByRole("button", { name: "Jepret" });
    await expect(rana).toBeEnabled({ timeout: 20_000 });
    await rana.click();
    // Jeda rana 400 ms: di bawah itu satu ketukan bisa terbaca dua kali.
    await page.waitForTimeout(500);
    await rana.click();
    await page.waitForTimeout(500);
    await rana.click();

    // Tiga ketukan → tiga petak di strip. Rana TIDAK pernah dinonaktifkan
    // selagi mengirim; ketukan yang hilang adalah kegagalan senyap.
    await expect
      .poll(async () => page.locator("img[alt='']").count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
    await expect(rana).toBeEnabled();
  });
});
