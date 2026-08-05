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

  test("halaman tampil TANPA menuntut pilih lokasi, dan tidak melebar", async ({ page }) => {
    const galat: string[] = [];
    page.on("pageerror", (e) => galat.push(String(e)));

    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Jepret sekarang" })).toBeVisible();

    /*
     * TIDAK ADA pemilih lokasi di langkah memotret (DECISIONS 254). Ini bukan
     * detail tampilan: begitu ada satu isian wajib sebelum rana, seluruh alasan
     * fitur ini ada ikut hilang. Kalau suatu saat pemilihnya kembali, uji inilah
     * yang menahannya — layarnya sendiri akan tampak baik-baik saja.
     */
    await expect(page.locator("#fc-lokasi")).toHaveCount(0);
    // Tombolnya harus langsung bisa ditekan, bukan menunggu isian apa pun.
    await expect(page.getByRole("button", { name: /simpan ke kantong/i })).toBeEnabled();

    /*
     * KAMERA SAJA (DECISIONS 255). Tombol Galeri tidak boleh ada di sini: foto
     * galeri tidak bisa menjamin koordinat maupun jam, jadi ia hampir selalu
     * jatuh ke tumpukan "belum ketahuan lokasinya" — kerja tangan yang justru
     * hendak dihapus fitur ini. Server juga menolak sumber dari klien (diuji di
     * tests/integration/foto-cepat.test.ts); yang dijaga di sini pintunya.
     */
    await expect(page.getByRole("button", { name: "Galeri" })).toHaveCount(0);
    await expect(page.getByText("Kamera", { exact: true })).toBeVisible();

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
    await page.getByRole("button", { name: /simpan ke kantong/i }).click();
    await expect(page.locator('[role="alert"], [role="status"]').first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
