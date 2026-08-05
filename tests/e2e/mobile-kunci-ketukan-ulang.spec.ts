import { test, expect, type Page } from "@playwright/test";
import { AMBANG_LAMBAT_MS } from "@/components/shell/nav-kunci-ulang";

/**
 * KUNCI KETUKAN ULANG PUNYA UJUNG (DECISIONS 255).
 *
 * DECISIONS 247 menahan ketukan ulang ke alamat yang sama supaya tiga ketukan
 * tidak jadi tiga permintaan halaman penuh yang berebut pipa 400 kbps. Yang
 * dikunci BERKAS INI adalah sisi sebaliknya: penahanan itu harus BERHENTI.
 *
 * Kalau tidak, kasus tepinya jadi keluhan aslinya sendiri — ketukan yang
 * ternyata tidak berujung navigasi membuat semua ketukan berikutnya ke tautan
 * itu ditelan tanpa jejak selama 20 detik, dan pengguna kembali menatap layar
 * yang "seperti tidak terjadi apa pun".
 *
 * Uji unit sudah mengunci ATURANNYA (`tests/unit/nav-kunci-ulang.test.ts`).
 * Yang dibuktikan di sini adalah aturan itu benar-benar SAMPAI ke peramban:
 * pendengar fase capture, `Date.now()`, dan tanda `data-navigating` bekerja
 * bersama seperti yang dimaksud.
 *
 * Navigasinya sengaja DIGANTUNG lewat `page.route` — bukan throttling — supaya
 * hasilnya sama persis di mesin mana pun. Yang diuji perilaku waktu, dan waktu
 * adalah satu-satunya hal yang tidak boleh diserahkan pada kecepatan CI.
 */

/** Navigasi digantung selama ini; harus jauh melewati ambang lepas kunci. */
const TAHAN_MS = AMBANG_LAMBAT_MS + 6000;

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
}

test.describe("kunci ketukan ulang", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "perilaku khusus ponsel");
    await login(page);
  });

  test("ditahan saat masih baru, DILEPAS sesudah pemberitahuan lambat muncul", async ({ page }) => {
    /*
     * URL KANONIK `/proyek/lokasi` (DECISIONS 252), bukan `/lokasi`.
     *
     * Uji ini lahir di cabang `dev` sebelum keluarga route dipindah. `/lokasi`
     * sendiri tetap hidup — ia 308 ke sini — tetapi TAUTAN di dalam halaman
     * sudah memakai bentuk baru, sehingga pemilih `a[href^="/lokasi/"]` tidak
     * mencocoki apa pun dan uji menggantung sampai batas waktu. Kegagalannya
     * menunjuk `waitFor`, jauh dari sebabnya.
     */
    await page.goto("/proyek/lokasi");
    const tautan = page.locator('a[href^="/proyek/lokasi/"]').first();
    await tautan.waitFor({ state: "visible", timeout: 30_000 });

    // Gantung navigasinya. Pra-ambil dibiarkan lewat — ia bukan navigasi, dan
    // menahannya hanya membuat halaman terasa aneh tanpa menambah apa pun.
    const navigasi: number[] = [];
    const mulai = Date.now();
    await page.route(/\/proyek\/lokasi\/[^/]+(\?|$)/, async (route) => {
      if (route.request().headers()["next-router-prefetch"]) return route.continue();
      navigasi.push(Date.now() - mulai);
      await new Promise((r) => setTimeout(r, TAHAN_MS));
      await route.continue();
    });

    await tautan.click();
    await expect(page.locator("a[data-navigating]")).toHaveCount(1, { timeout: 2000 });
    // TUNGGU permintaannya benar-benar terbit. Tanda `data-navigating` dipasang
    // seketika saat klik, sedangkan permintaan RSC-nya terbit sesaat kemudian —
    // memeriksa hitungannya persis di situ berarti mengadu cepat-cepatan dengan
    // peramban, dan uji yang kalah balapan melapor "gagal" untuk sebab yang
    // sama sekali bukan yang sedang diuji. (Sempat terjadi.)
    await expect
      .poll(() => navigasi.length, {
        message: "ketukan pertama tidak menghasilkan permintaan halaman",
        timeout: 5000,
      })
      .toBe(1);

    // MASIH DALAM JENDELA KUNCI → ketukan ulang ditelan, dan itu memang benar:
    // permintaan pertama sedang berjalan, duplikatnya cuma merebut pipa.
    await page.waitForTimeout(1000);
    await tautan.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    expect(
      navigasi.length,
      `ketukan pada detik ke-1 menambah permintaan (${navigasi.join(", ")} ms)`,
    ).toBe(1);

    // Pemberitahuan "jaringan sepertinya lambat" WAJIB sudah tampil di ambang
    // yang sama — inilah alasan kuncinya boleh dilepas: pengguna sudah diberi
    // tahu keadaannya, jadi ketukannya tidak lagi pantas ditelan diam-diam.
    await expect(page.getByRole("status").filter({ hasText: /jaringan/i })).toBeVisible({
      timeout: AMBANG_LAMBAT_MS + 2000,
    });

    // SESUDAH AMBANG → ketukan pengguna kembali berarti.
    await tautan.click({ force: true });
    await expect
      .poll(() => navigasi.length, {
        message: "ketukan sesudah ambang lambat masih ditelan — pengguna terkunci tanpa tanda",
        timeout: 3000,
      })
      .toBe(2);

    expect(
      navigasi[1],
      `pelepasan terjadi pada ${navigasi[1]} ms, mestinya tidak sebelum ${AMBANG_LAMBAT_MS} ms`,
    ).toBeGreaterThanOrEqual(AMBANG_LAMBAT_MS);
  });
});
