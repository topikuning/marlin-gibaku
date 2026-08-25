import { test, expect, type Page } from "@playwright/test";

/**
 * RENCANA & RAB — ketiga bagian harus TERLIHAT, bukan tertimbun (DECISIONS 362).
 *
 * Laporan user 2026-08-18: *"menu RAB dan Rencana, saat ini terlalu panjang
 * scroll ke bawah. bahkan ada pengguna yang bilang baru tau kalau ternyata ada
 * fitur rencana, karena terlalu ke bawah menunya."*
 *
 * Yang diuji di sini bukan "apakah sub-tabnya ada" — itu bisa benar sambil tetap
 * berada 4000px di bawah lipatan. Yang diuji: **ketiga bagian bisa dilihat tanpa
 * menggulir**, pada layar ponsel, di lokasi yang RAB-nya besar. Itulah keluhannya.
 *
 * Prasyarat: DB e2e ter-seed, server jalan di baseURL.
 */

const LOKASI = process.env.E2E_SLUG_RAB ?? "kedungmutih";

async function login(page: Page, username = "admin") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 });
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Bagian Rencana & RAB" });

test.describe("Rencana & RAB – sub-tab", () => {
  test("ketiga bagian terlihat TANPA menggulir", async ({ page }) => {
    await login(page);
    /*
     * 375px DIPAKSA, bukan mengandalkan lebar proyek 'mobile'.
     *
     * Perangkat proyek mobile Playwright (Pixel 7) selebar 412px, dan pada
     * lebar itu pil terakhir masih muat sementara di 375px ia terpotong —
     * penjaganya hijau padahal cacatnya ada. 375px adalah lebar ponsel yang
     * benar-benar dipakai di lapangan.
     */
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/lokasi/${LOKASI}/rab`);
    await nav(page).waitFor({ timeout: 20_000 });

    const { width: lebarLayar, height: tinggiLayar } = page.viewportSize()!;
    for (const label of ["RAB Aktif", "Rencana Mingguan", "Revisi & Adendum"]) {
      const kotak = await nav(page).getByRole("link", { name: label }).boundingBox();
      expect(kotak, `${label} tidak ditemukan`).not.toBeNull();
      // Inti ujinya. Sebelum ini, "Rencana mingguan" ada di bawah pohon RAB
      // berisi ratusan baris — secara harfiah ribuan piksel di bawah lipatan.
      expect(kotak!.y + kotak!.height, `${label} di bawah lipatan`).toBeLessThanOrEqual(tinggiLayar);
      // Dan UTUH ke samping: pil yang separuh terpotong di tepi kanan adalah
      // persis cara sebuah bagian berhenti ditemukan orang. Barisnya memang
      // bisa digeser, tapi menggeser hanya dilakukan yang sudah tahu.
      expect(kotak!.x, `${label} terpotong kiri`).toBeGreaterThanOrEqual(0);
      expect(kotak!.x + kotak!.width, `${label} terpotong kanan`).toBeLessThanOrEqual(lebarLayar);
    }
  });

  test("halaman tidak lagi memuat ketiganya sekaligus", async ({ page }) => {
    // Bukan soal kerapian: pohon RAB ratusan item ikut diserialisasi ke klien.
    // Kalau semua bagian dirender bersamaan lagi, halamannya kembali panjang
    // dan berat sekaligus.
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/rab`);
    await nav(page).waitFor({ timeout: 20_000 });
    await expect(page.getByRole("table").filter({ hasText: "Total (pra-PPN)" })).toHaveCount(0);
  });

  test("berpindah bagian membawa minggu yang sedang dilihat", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/rab?bagian=rencana&minggu=3`);
    await nav(page).waitFor({ timeout: 20_000 });

    await nav(page).getByRole("link", { name: /RAB Aktif/ }).click();
    await expect(page).toHaveURL(/bagian=rab/);
    await expect(page).toHaveURL(/minggu=3/);

    await nav(page).getByRole("link", { name: /Rencana Mingguan/ }).click();
    await expect(page).toHaveURL(/bagian=rencana/);
    // Kalau minggunya hilang di sini, orang mendarat di minggu berjalan dan
    // mengira rencana yang barusan ia isi terhapus.
    await expect(page).toHaveURL(/minggu=3/);
  });

  test("mengganti minggu TIDAK melempar keluar dari bagian rencana", async ({ page }) => {
    /*
     * Regresi yang lahir dari sub-tab itu sendiri: penukar minggu menulis ulang
     * alamatnya dari nol (`?minggu=N`), yang aman selama `minggu` satu-satunya
     * parameter. Begitu ada `?bagian=`, memilih minggu melempar orang kembali
     * ke pohon RAB — persis saat ia sedang mengisi rencana.
     */
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/rab?bagian=rencana&minggu=2`);
    await nav(page).waitFor({ timeout: 20_000 });

    const pilih = page.getByLabel("Minggu", { exact: true });
    if ((await pilih.count()) === 0) test.skip(true, "lokasi ini belum punya RAB aktif");
    await pilih.first().click();
    await page.getByRole("option", { name: /^Minggu 4/ }).click();

    await expect(page).toHaveURL(/minggu=4/);
    await expect(page).toHaveURL(/bagian=rencana/);
    await expect(nav(page).getByRole("link", { name: /Rencana Mingguan/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("bagian ngawur mendarat di bagian yang sah, bukan halaman kosong", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/rab?bagian=ngawur`);
    await expect(nav(page).getByRole("link", { name: /RAB Aktif/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
