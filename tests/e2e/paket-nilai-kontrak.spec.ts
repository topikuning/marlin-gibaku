import { test, expect, type Page } from "@playwright/test";

/**
 * DAFTAR PAKET MENYEBUT NILAI KONTRAK, BUKAN CUMA PAGUNYA.
 *
 * Keberatan user 2026-09-03: *"buat apa di daftar paket kamu masukkan kolom
 * HPS, sedangkan kolom kontrak tidak kamu masukkan. ini sangat
 * membingungkan."*
 *
 * HPS itu PAGU — angka sebelum tender. Begitu paket berkontrak, yang dipakai
 * orang menyebut nilai paket adalah NILAI KONTRAK, dan daftar ini justru
 * satu-satunya layar yang tidak memuatnya. Memajang pagu sendirian membuat
 * pembacanya mengira itu nilai paketnya.
 *
 * Diuji dari LAYAR, bukan dari definisi kolom: kolom yang ditulis di berkas
 * grid tapi datanya tidak pernah sampai dari server akan lolos pemeriksaan
 * sumber dan tetap kosong di mata pengguna (blind spot §5 CARA_KERJA_AGEN).
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

test.describe("daftar paket: pagu dan kontrak berdampingan", () => {
  test("kolom Nilai Kontrak ada di samping HPS", async ({ page, isMobile }) => {
    /*
     * Hanya desktop. Di lebar ponsel AG Grid MEMVIRTUALKAN kolomnya: yang di
     * luar layar tidak ada di DOM sama sekali, jadi uji ini akan merah di sana
     * untuk alasan yang salah.
     */
    test.skip(isMobile === true, "kolom AG Grid divirtualkan di lebar ponsel");
    await login(page, "admin");
    await page.goto("/paket");
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("columnheader", { name: "HPS" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Nilai Kontrak" })).toBeVisible();
  });

  test("paket berkontrak menampilkan angka rupiah, bukan sel kosong", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "kolom AG Grid divirtualkan di lebar ponsel");
    await login(page, "admin");
    await page.goto("/paket");
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 15_000 });

    /*
     * Seed memuat paket berkontrak DAN paket yang belum. Yang dijaga di sini:
     * tiap sel kolom itu BERBICARA — entah rupiahnya, entah "belum
     * berkontrak". Sel kosong adalah kegagalan yang paling mudah lolos, sebab
     * ia terbaca "datanya belum diisi" padahal keadaannya "memang belum ada".
     */
    const sel = page.locator('.ag-row [col-id="contractValue"]');
    await expect(sel.first()).toBeVisible({ timeout: 15_000 });
    const isi = await sel.allInnerTexts();
    expect(isi.length).toBeGreaterThan(0);
    for (const t of isi) expect(t.trim()).not.toBe("");
    // Sedikitnya satu paket seed sudah berkontrak → ada rupiahnya.
    expect(isi.some((t) => t.includes("Rp"))).toBe(true);
  });
});
