import { expect, test, type Page } from "@playwright/test";

/**
 * SETIAP AKSI DI TAB LAPORAN HARUS MENGAKU SEDANG BEKERJA (DECISIONS 400).
 *
 * Keluhan user 2026-08-21: *"aku sudah pernah komplain terkait klik whatsapp
 * dan upload ke drive, atau aksi apapun di sini, ketika diklik tidak memberikan
 * tanda apapun kalau sedang proses. tapi kenapa masih belum tersolusikan!"*
 *
 * Keluhan yang SAMA sudah pernah ditutup sekali (DECISIONS 360) — tapi hanya
 * untuk pilihan yang memanggil server action. Tautan sengaja dikecualikan oleh
 * TIPE-nya (`labelSibuk?: never`), jadi "Tampilkan" dan "Unduh" tetap diam.
 * Diukur di sini sebelum diperbaiki: Tampilkan 8,9 detik, unduh PDF 4,1 detik,
 * dua-duanya tanpa satu pun perubahan di layar.
 *
 * ### Kenapa uji ini E2E, bukan unit
 *
 * Uji unitnya (`tests/unit/menu-berkas.test.tsx`) merender `loading: true` lalu
 * memeriksa markup — ia membuktikan BENTUK kepingan sibuknya, bukan bahwa
 * menekan tombol benar-benar menerbitkannya. Justru celah itu yang membuat
 * cacat ini lolos: penanda yang ada tapi tidak pernah menyala. Yang bisa
 * membedakan keduanya cuma peramban sungguhan.
 */

const LOKASI = "batah-timur";
const URL = `/lokasi/${LOKASI}/laporan-lokasi?kind=mingguan&n=19&show=1`;

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Kendali MenuBerkas: pembungkus yang memuat `<summary>` panahnya. */
const menuBerkas = (page: Page, judul: string) =>
  page.locator("div.relative.inline-flex:has(summary)").filter({ hasText: judul }).first();

/*
 * Kepingan sibuk dicari di TINGKAT HALAMAN, bukan di dalam kendalinya.
 *
 * Sengaja: selagi sibuk, `MenuBerkas` MENGGANTI seluruh kendali dengan kepingan
 * itu — tombol dan panahnya tidak diredupkan, mereka hilang. Jadi pembungkus
 * yang disyaratkan memuat `<summary>` justru berhenti cocok tepat pada saat
 * yang ingin diperiksa. (Versi pertama uji ini memerah karena itu; ujinya yang
 * salah, bukan perbaikannya.)
 */
const kepinganSibuk = (page: Page) => page.getByRole("status").filter({ hasText: /Menyiapkan/i });

test.describe("penanda sibuk tab Laporan", () => {
  test("UNDUH berkas: kepingan sibuk muncul, lalu berkasnya benar-benar turun", async ({
    page,
  }) => {
    await login(page);
    await page.goto(URL);

    const pdf = menuBerkas(page, "Laporan Mingguan (PDF)");
    await expect(pdf).toBeVisible({ timeout: 30_000 });
    await pdf.locator("summary").click();

    const unduhan = page.waitForEvent("download", { timeout: 60_000 });
    await pdf.locator('[role="menu"] a', { hasText: "Unduh" }).first().click();

    /*
     * Inti keluhannya. `role="status"` harus TERBIT — dan kalau ia hanya sempat
     * berkedip sekejap, itu tetap lulus di sini; yang tidak boleh adalah tidak
     * pernah ada sama sekali, yang persis keadaan sebelum perbaikan ini.
     */
    await expect(kepinganSibuk(page)).toBeVisible({ timeout: 5_000 });

    // Dan penandanya harus benar-benar mewakili pekerjaan: berkasnya turun.
    const berkas = await unduhan;
    expect(await berkas.suggestedFilename()).toMatch(/\.pdf$/i);

    // Sesudah selesai, kendalinya kembali — bukan tombol yang mati selamanya.
    await expect(menuBerkas(page, "Laporan Mingguan (PDF)").locator("summary")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kepinganSibuk(page)).toHaveCount(0);
  });

  test("UNDUH berkas: selagi berjalan tidak ada kendali yang bisa diklik dua kali", async ({
    page,
  }) => {
    /*
     * Bukan soal rapi. Menekan "Unduh" tiga kali karena layarnya diam berarti
     * server membangun PDF yang sama tiga kali — dan pada pintu WhatsApp,
     * kejadian aslinya 2026-08-18: pesan terkirim berkali-kali ke grup.
     */
    await login(page);
    await page.goto(URL);

    const pdf = menuBerkas(page, "Laporan Mingguan (PDF)");
    await expect(pdf).toBeVisible({ timeout: 30_000 });
    await pdf.locator("summary").click();
    await pdf.locator('[role="menu"] a', { hasText: "Unduh" }).first().click();

    await expect(kepinganSibuk(page)).toBeVisible({ timeout: 5_000 });

    // Tombol "Laporan Mingguan (PDF)" beserta panahnya HILANG selagi berjalan,
    // bukan sekadar diredupkan — tidak ada yang tersisa untuk ditekan lagi.
    await expect(page.getByRole("link", { name: "Laporan Mingguan (PDF)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Pilihan lain untuk Laporan Mingguan/ })).toHaveCount(0);
  });

  test("TAMPILKAN: tombolnya mengaku sedang menyiapkan", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/laporan-lokasi`);

    const tampilkan = page.getByRole("button", { name: /Tampilkan|Menyiapkan laporan/ });
    await expect(tampilkan).toBeVisible({ timeout: 30_000 });
    await tampilkan.click();

    // Laporan periodik dibangun dari RAB + baseline + seluruh laporan harian
    // periode itu; diukur ~9 detik. Diam selama itu = ditekan lagi.
    await expect(page.getByRole("button", { name: /Menyiapkan laporan/ })).toBeVisible({
      timeout: 5_000,
    });
  });
});
