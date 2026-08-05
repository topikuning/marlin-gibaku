import { test, expect } from "@playwright/test";

/**
 * FOTO TIDAK BOLEH HILANG SAAT SINYAL PUTUS (DECISIONS 257).
 *
 * Permintaan user: *"perlu solusi juga jika jaringan jelek, atau offline"*.
 *
 * Sebelum ini, hasil jepretan hanya ada di MEMORI sampai unggahannya berhasil —
 * jadi sinyal putus, tab tertutup, atau baterai habis berarti bukti lapangan
 * lenyap tanpa jejak. Cacat itu SENYAP: layarnya tetap normal, dan tidak ada
 * yang akan tahu foto itu pernah ada.
 *
 * Berkas ini menirukan keadaan lapangan yang sebenarnya: memotret DI LUAR
 * jangkauan, lalu sinyal kembali. Yang dijanjikan bukan "unggahannya cepat",
 * melainkan fotonya SELAMAT dan akhirnya sampai tanpa disuruh.
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

async function bukaKamera(page: import("@playwright/test").Page) {
  await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /buka kamera/i }).click();
  const video = page.getByLabel("Pratinjau kamera");
  await expect
    .poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  const rana = page.getByRole("button", { name: "Jepret" });
  await expect(rana).toBeEnabled({ timeout: 20_000 });
  return rana;
}

test.describe("Foto Cepat — jaringan jelek / offline", () => {
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

  test("jepret saat OFFLINE → foto masuk antrean, tidak hilang", async ({ page, context }) => {
    const rana = await bukaKamera(page);
    await context.setOffline(true);
    await rana.click();

    // Antrean harus MUNCUL dan menyebut jumlahnya. Antrean yang disembunyikan
    // membuat orang mengira fotonya sudah aman di server padahal masih di HP.
    await expect(page.getByText(/foto menunggu terkirim/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("tidak ada jaringan")).toBeVisible();
    await context.setOffline(false);
  });

  test("foto BERTAHAN melewati muat ulang halaman", async ({ page }) => {
    /*
     * Inti janjinya, dan bagian yang paling mudah rusak tanpa terlihat: kalau
     * antreannya cuma di memori, muat ulang menghapusnya diam-diam.
     *
     * Yang digagalkan di sini adalah UNGGAHANNYA, bukan seluruh jaringan.
     * Sebabnya jujur: tanpa service worker, halaman ini TIDAK bisa dimuat ulang
     * dalam keadaan benar-benar offline — dan itu memang belum dijanjikan
     * (PWA offline penuh masih ditunda, lihat OPEN_ISSUES). Yang dijanjikan:
     * foto yang sudah terlanjur dijepret tidak hilang.
     */
    await page.route(/./, async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) return route.abort();
      return route.continue();
    });

    const rana = await bukaKamera(page);
    await rana.click();
    await expect(page.getByText(/foto menunggu terkirim/i)).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    // Antreannya dibaca ULANG dari simpanan perangkat, bukan dari memori yang
    // sudah lenyap bersama halaman lama.
    await expect(page.getByText(/foto menunggu terkirim/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("img[alt='']").first()).toBeVisible();
  });

  test("sinyal kembali → antrean terkirim sendiri, tanpa disuruh", async ({ page, context }) => {
    const rana = await bukaKamera(page);
    await context.setOffline(true);
    await rana.click();
    await expect(page.getByText(/foto menunggu terkirim/i)).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
    /*
     * Panel antrean HILANG artinya foto sudah benar-benar diterima server dan
     * dibuang dari perangkat. Di lingkungan uji tanpa penyimpanan foto, server
     * MENOLAK dengan alasan yang jelas — dan itu pun harus terlihat sebagai
     * "ditolak", bukan menggantung selamanya sebagai "antre". Dua-duanya bukti
     * antreannya BERJALAN; yang dilarang adalah diam.
     */
    await expect
      .poll(
        async () =>
          (await page.getByText(/foto menunggu terkirim/i).count()) === 0 ||
          (await page.getByText(/ditolak server/i).count()) > 0,
        { message: "antrean tidak bergerak setelah sinyal kembali", timeout: 45_000 },
      )
      .toBe(true);
  });
});
