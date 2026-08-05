import { test, expect } from "@playwright/test";

/**
 * FOTO CEPAT terbuka & terpakai di ponsel (DECISIONS 253).
 *
 * Uji unit mengunci aturan jaraknya, uji integrasi mengunci aturan simpan/pakai.
 * Yang TIDAK terjangkau keduanya: apakah halamannya benar-benar dirender, apakah
 * pemilih lokasinya terisi, dan apakah tombolnya benar-benar tersambung ke
 * server action. Ketiganya bisa rusak tanpa satu pun uji lain berubah warna —
 * dan rusaknya berupa layar yang tampak baik-baik saja.
 */
test.describe("Foto Cepat", () => {
  test.beforeEach(async ({ page, context }) => {
    test.skip(test.info().project.name !== "mobile", "alur lapangan = ponsel");
    // Izin lokasi diberikan supaya urutan "terdekat" benar-benar dijalankan;
    // tanpa ini jalur pengurutannya tidak pernah tersentuh di uji.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: -6.87, longitude: 112.5 });
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  });

  test("halaman tampil, pemilih lokasi terisi, tidak melebar", async ({ page }) => {
    const galat: string[] = [];
    page.on("pageerror", (e) => galat.push(String(e)));

    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Jepret sekarang" })).toBeVisible();

    // Pemilih lokasi WAJIB Combobox (bisa diketik-cari), bukan <select> native —
    // aturan repo, dan di lapangan daftar lokasinya panjang.
    await page.locator("#fc-lokasi").click();
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
    expect(await page.getByRole("option").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    const lebar = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(lebar, "halaman melebar melewati layar ponsel").toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    expect(galat, "ada galat runtime").toEqual([]);
  });

  test("tombol simpan benar-benar tersambung ke server action", async ({ page }) => {
    // Tanpa ini, form yang tidak tersambung akan tampak normal: ditekan, tidak
    // terjadi apa-apa, dan tidak ada yang gagal. Isi pesannya sengaja TIDAK
    // dipatok — yang dijanjikan adalah server MENJAWAB, bukan jawaban tertentu
    // (lingkungan uji bisa punya/tidak punya penyimpanan foto).
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await page.locator("#fc-lokasi").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /simpan ke kantong/i }).click();
    await expect(page.locator('[role="alert"], [role="status"]').first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
