import { test, expect, type Page } from "@playwright/test";

/**
 * PINDAH LOKASI HARUS BISA DILAKUKAN DARI PONSEL.
 *
 * Keluhan user 2026-08-13: *"lokasi di mobile kenapa tidak bisa ada pilihan
 * pindah ke lokasi lain?"* — dan memang tidak bisa. Pemilih lokasi (DECISIONS
 * 204) hanya dipasang di header desktop, yang di ponsel disembunyikan utuh
 * (`max-sm:hidden`, DECISIONS 219); baris pengganti di ponsel cuma mencetak
 * nama lokasi sebagai teks mati. Jadi selama sepuluh bulan fitur itu ADA di
 * kode dan TIDAK ADA di layar orang yang paling sering memakainya — mandor dan
 * site manager bekerja dari HP.
 *
 * Diuji lewat browser sungguhan karena yang salah bukan logikanya melainkan
 * BREAKPOINT-nya: kedua header sama-sama ada di DOM, yang memilih hanya CSS.
 * Uji unit yang me-render komponennya akan lulus dengan gembira pada bug ini.
 *
 * Karena itu semua pemeriksaan di bawah memakai `:visible` — mencari elemennya
 * di DOM justru pemeriksaan yang tidak membuktikan apa-apa di sini.
 */

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 30_000 });
}

/**
 * Pemicu pemilih lokasi yang BENAR-BENAR terlihat. Nama aksesibelnya adalah
 * nama lokasi (isi tombolnya), bukan `title`-nya — jadi patokannya `aria-*`.
 */
const PEMICU = 'button[aria-haspopup="listbox"]:visible';
const DAFTAR = '[role="listbox"]:visible';

/** Paket berisi lebih dari satu lokasi pada data seed. */
const ASAL = "tengket";
const TUJUAN = "batah-timur";

test.describe("pemilih lokasi di ponsel", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "mobile", "keluhannya soal layar ponsel");
  });

  test("nama lokasi bisa diketuk dan membawa sub-halaman yang sedang dibuka", async ({ page }) => {
    await login(page, "admin");
    // SENGAJA bukan Ringkasan: nilai pemilih ini justru saat sedang memeriksa
    // hal yang sama di beberapa lokasi berturut-turut. Kalau ketukannya
    // mendarat di Ringkasan, tab-nya harus dicari lagi — di ponsel tab-tab itu
    // digulir mendatar, jadi ongkosnya lebih mahal daripada di desktop.
    await page.goto(`/lokasi/${ASAL}/progress`);

    const pemicu = page.locator(PEMICU);
    await expect(pemicu, "nama lokasi di ponsel harus jadi tombol, bukan teks mati").toBeVisible({
      timeout: 30_000,
    });

    // Cukup besar untuk jempol. Baris ini padat (nama + status + deviasi), dan
    // kontrol yang mengecil sampai meleset saat diketuk sama saja tidak ada.
    const kotak = (await pemicu.boundingBox())!;
    expect(kotak.height, "tinggi pemicu harus tetap bisa diketuk jempol").toBeGreaterThanOrEqual(36);

    await pemicu.tap();
    const daftar = page.locator(DAFTAR);
    await expect(daftar).toBeVisible();

    // Daftarnya harus muat di layar — panel yang separuhnya di luar tepi kanan
    // membuat status dan deviasi tiap lokasi tak terbaca.
    const kd = (await daftar.boundingBox())!;
    const lebar = page.viewportSize()!.width;
    expect(kd.x, "panel tidak boleh keluar tepi kiri").toBeGreaterThanOrEqual(0);
    expect(kd.x + kd.width, "panel tidak boleh keluar tepi kanan").toBeLessThanOrEqual(lebar + 1);

    const opsi = daftar.getByRole("option");
    await expect(opsi).toHaveCount(2);
    // Bukan sekadar nama: tiap baris membawa wilayah, status, dan deviasinya,
    // jadi pilihan bisa diambil tanpa membuka satu per satu dulu.
    await expect(opsi.first()).toContainText("Bangkalan");

    await daftar.getByRole("option", { name: /Batah Timur/ }).tap();
    await page.waitForURL(new RegExp(`/lokasi/${TUJUAN}/progress`), { timeout: 30_000 });
    await expect(page.locator(PEMICU)).toContainText("Batah Timur");
  });

  test("halaman tidak melebar gara-gara pemicu ini", async ({ page }) => {
    // Baris identitas di ponsel harus menampung nama + status + deviasi + kotak
    // pemicu. Kalau melebar, seisi halaman diperkecil di Safari iOS
    // (alasan yang sama dengan DECISIONS 217).
    await login(page, "admin");
    await page.goto(`/lokasi/${ASAL}/progress`);
    await expect(page.locator(PEMICU)).toBeVisible({ timeout: 30_000 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "halaman tidak boleh bisa digeser ke samping").toBeLessThanOrEqual(
      clientWidth + 1,
    );
  });

  test("paket berisi satu lokasi TIDAK diberi pemicu yang tak menuju ke mana-mana", async ({
    page,
  }) => {
    // Kontrol yang membuka daftar berisi satu baris — dirinya sendiri — hanya
    // mengajari orang bahwa menekannya tidak ada gunanya.
    await login(page, "admin");
    await page.goto("/lokasi/purworejo");
    // `.filter({ visible: true })` bukan kerewelan: judul desktop tetap ada di
    // DOM (cuma di-`display:none`), jadi tanpa saringan ini yang ditunggu
    // adalah elemen yang memang tidak akan pernah terlihat di ponsel.
    await expect(
      page.getByText("Purworejo", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(PEMICU)).toHaveCount(0);
  });
});

test.describe("header desktop tidak ikut berubah", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "yang dijaga versi lebarnya");
  });

  test("panah urut tetap ada, dan judulnya tetap SATU h1", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`/lokasi/${ASAL}/progress`);
    await expect(page.getByRole("button", { name: "Lokasi berikutnya" })).toBeVisible({
      timeout: 30_000,
    });
    // Kedua header ada di DOM sekaligus — versi ponsel karena itu TIDAK boleh
    // memakai <h1>, atau setiap halaman lokasi punya dua judul utama.
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
