import { expect, test, type Page } from "@playwright/test";

/**
 * TAB LAPORAN: KEADAAN DRIVE & WHATSAPP TERBACA TANPA MEMBUKA APA PUN
 * (DECISIONS 406).
 *
 * Permintaan user 2026-08-21: *"pada laporan harian informasi yang diutamakan
 * adalah apakah sudah diupload ke drive atau ke whatsap. tombol-tombolnya boleh
 * muncul langsung, tapi jika window kecil makan menyesuaikan."*
 *
 * ### Kenapa E2E, dan apa yang TIDAK dibuktikan di sini
 *
 * Aturan angkanya sudah diuji murni di `tests/unit/riwayat-harian.test.ts`. Yang
 * tidak bisa dibuktikan di sana ada dua, dan dua-duanya justru inti permintaan:
 *
 *  1. keterangannya benar-benar TERBACA di layar tanpa membuka menu – cacat
 *     lamanya persis ini: datanya sudah ada, tapi disimpan sebagai `hint` di
 *     dalam menu, jadi butuh tiga puluh kali klik untuk satu pertanyaan;
 *  2. tombolnya meringkas sendiri saat jendela sempit. Itu keputusan CSS
 *     (`xl:`), dan satu-satunya cara membuktikannya adalah mengubah lebar
 *     jendela sungguhan.
 *
 * Yang TIDAK dibuktikan: bahwa unggahan Drive/WhatsApp-nya berhasil. Itu butuh
 * kredensial Google & WAHA sungguhan; yang diperiksa di sini keadaan yang
 * DILAPORKAN layar, bukan jaringannya.
 */

const LOKASI = "kedungmutih";
const URL = `/lokasi/${LOKASI}/laporan-lokasi`;

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/*
 * Judul kartunya, BUKAN `getByText("Laporan harian final")`.
 *
 * Pencocokan teks bebas Playwright itu SUBSTRING. Begitu kartu di atasnya
 * memuat kalimat "…laporan harian final…", pemilih lama cocok ke dua tempat
 * sekaligus dan gagal sebagai strict-mode violation – ujinya merah untuk
 * halaman yang benar. `exact: true` mengunci ke judul kartunya saja.
 */
const judulKartu = (page: Page) => page.getByText("Laporan harian final", { exact: true });

/** Baris laporan harian final pertama. */
const barisPertama = (page: Page) => page.locator("li").filter({ hasText: /item/ }).first();

test.describe("keadaan kiriman laporan harian", () => {
  test("setiap baris menyatakan Drive dan WhatsApp tanpa menu dibuka", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(URL);

    await expect(judulKartu(page)).toBeVisible({ timeout: 30_000 });

    /*
     * Uji ini tidak berarti apa-apa tanpa laporan final. Kalau seednya berubah
     * dan daftarnya kosong, yang benar adalah MERAH – bukan hijau yang
     * membuktikan nol.
     */
    const jumlah = page.locator("p", { hasText: /^Laporan final$/i }).locator("..").locator("p").nth(1);
    await expect(jumlah).toBeVisible();
    expect(Number(await jumlah.innerText())).toBeGreaterThan(0);

    // Empat angka ringkas – dan yang diutamakan user ada di antaranya.
    for (const label of ["Laporan final", "Sudah ke Drive", "Sudah ke WhatsApp", "Belum dikirim"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // Inti keluhannya: keterangan Drive & WA TERBACA langsung, bukan `hint`
    // yang harus digali dari dalam menu.
    const baris = barisPertama(page);
    await expect(baris.getByText(/Belum ke Drive|^Drive ·/)).toBeVisible();
    await expect(baris.getByText(/Belum ke WhatsApp|^WhatsApp ·/)).toBeVisible();
  });

  test("jendela LEBAR: tombolnya langsung terlihat", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(URL);
    await expect(judulKartu(page)).toBeVisible({ timeout: 30_000 });

    const baris = barisPertama(page);
    // "boleh muncul langsung" – tanpa satu ketukan pun untuk membukanya.
    await expect(baris.getByRole("link", { name: "Buka", exact: true })).toBeVisible();
    await expect(baris.getByRole("link", { name: /Cetak/ })).toBeVisible();
    await expect(baris.getByRole("link", { name: /PDF/ })).toBeVisible();
    await expect(baris.getByRole("button", { name: /Drive/ })).toBeVisible();
    await expect(baris.getByRole("button", { name: /WA/ })).toBeVisible();
  });

  test("jendela SEMPIT: tombolnya melipat jadi satu menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(URL);
    await expect(judulKartu(page)).toBeVisible({ timeout: 30_000 });

    const baris = barisPertama(page);
    /*
     * Deret tombolnya tetap ADA di DOM (pergantiannya CSS, bukan pemasangan
     * ulang komponen) – yang diuji karena itu KETERLIHATANNYA, bukan jumlahnya.
     * Menguji `toHaveCount(0)` di sini akan merah untuk perilaku yang benar.
     */
    await expect(baris.getByRole("link", { name: "Buka", exact: true })).toBeHidden();
    /*
     * Dicari lewat CSS, BUKAN `getByRole("button")`. `<summary>` tidak dipetakan
     * ke peran button oleh Playwright – versi pertama uji ini memakai peran dan
     * memerah dengan "element(s) not found" padahal tombolnya ada dan terlihat.
     * (Uji lama `laporan-penanda-sibuk.spec.ts` memakai peran yang sama untuk
     * `toHaveCount(0)`, jadi ia hijau tanpa memeriksa apa pun – ikut dibetulkan.)
     */
    await expect(baris.locator('summary[aria-label="Pilihan lain untuk Laporan Harian"]')).toBeVisible();

    // Dan halamannya tidak boleh melebar ke samping di lebar ponsel.
    const lebar = await page.evaluate(() => ({
      isi: document.documentElement.scrollWidth,
      layar: document.documentElement.clientWidth,
    }));
    expect(lebar.isi).toBeLessThanOrEqual(lebar.layar + 1);
  });
});
