import { test, expect, type Page } from "@playwright/test";

/**
 * DUA HALAMAN, DUA PERTANYAAN — dan bedanya harus terlihat di layar.
 *
 * Keberatan user 2026-08-30: *"halaman lokasi dan progress, apa bedanya?
 * sangat mirip"*. Memang mirip: keduanya memanggil `getLocationsProgress()`
 * yang sama, dan keduanya memajang Rencana/Realisasi/Deviasi per lokasi.
 *
 * Pembagiannya sekarang:
 *
 *  - `/lokasi` = DIREKTORI. Untuk mencari satu lokasi. Urut nama, memuat
 *    lokasi yang belum jalan sekalipun. Dari progres cuma menyisakan Deviasi,
 *    sederajat dengan Status: penanda "sedang bermasalah", bukan pemantauan.
 *  - `/progress` = PAPAN TAGIHAN. Untuk memeringkat yang tertinggal. Hanya
 *    lokasi aktif, urut deviasi terburuk, plus kolom TERAKHIR LAPOR yang
 *    memisahkan yang tertinggal dari yang bahkan tidak melapor.
 *
 * Diuji dari layar, bukan dari definisi kolom: kolom yang dihapus di berkas
 * grid tapi masih terkirim dari server akan lolos pemeriksaan sumber dan tetap
 * muncul di mata pengguna (blind spot §5 CARA_KERJA_AGEN).
 *
 * Prasyarat: `pnpm db:seed`.
 */

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 10_000 }).catch(() => {});
}

/** Tunggu gridnya benar-benar berisi, bukan sekadar kerangkanya. */
async function tungguGrid(page: Page) {
  await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("lokasi = direktori, progress = papan tagihan", () => {
  test("direktori lokasi tidak lagi memajang Rencana & Realisasi", async ({ page, isMobile }) => {
    /*
     * Hanya desktop. Di lebar ponsel AG Grid MEMVIRTUALKAN kolomnya: yang di
     * luar layar tidak ada di DOM sama sekali. Uji ketiadaan "Rencana" akan
     * hijau di sana untuk alasan yang salah – bukan karena kolomnya dibuang,
     * melainkan karena belum digulir ke situ. Hijau semacam itu lebih buruk
     * daripada tidak ada uji (blind spot §5 CARA_KERJA_AGEN).
     */
    test.skip(isMobile === true, "kolom AG Grid divirtualkan di lebar ponsel");
    await login(page, "admin");
    await page.goto("/lokasi");
    await tungguGrid(page);

    // Yang tersisa dari progres: satu penanda saja.
    await expect(page.getByRole("columnheader", { name: "Deviasi" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();

    // Dua kolom yang membuatnya kembar dengan papan progress.
    await expect(page.getByRole("columnheader", { name: "Rencana" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Realisasi" })).toHaveCount(0);
  });

  test("papan progress bisa dicari dan diekspor – dulu tidak bisa keduanya", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/progress");
    await tungguGrid(page);

    await expect(page.getByRole("searchbox", { name: "Cari di tabel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unduh CSV" })).toBeVisible();
  });

  test("papan progress menyebut kapan lapangan terakhir mengirim laporan", async ({
    page,
    isMobile,
  }) => {
    /*
     * Hanya desktop. Di lebar ponsel AG Grid MEMVIRTUALKAN kolomnya: yang di
     * luar layar tidak ada di DOM sama sekali. Uji ketiadaan "Rencana" akan
     * hijau di sana untuk alasan yang salah – bukan karena kolomnya dibuang,
     * melainkan karena belum digulir ke situ. Hijau semacam itu lebih buruk
     * daripada tidak ada uji (blind spot §5 CARA_KERJA_AGEN).
     */
    test.skip(isMobile === true, "kolom AG Grid divirtualkan di lebar ponsel");
    await login(page, "admin");
    await page.goto("/progress");
    await tungguGrid(page);

    await expect(page.getByRole("columnheader", { name: "Terakhir lapor" })).toBeVisible();
    // Angka progresnya tetap di sini — inilah halaman yang memang memantau.
    await expect(page.getByRole("columnheader", { name: "Rencana" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Realisasi" })).toBeVisible();
  });

  test("pencarian di papan progress benar-benar menyaring barisnya", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/progress");
    await tungguGrid(page);

    const semula = await page.locator(".ag-row").count();
    await page.getByRole("searchbox", { name: "Cari di tabel" }).fill("kedungmutih");
    await expect(page.locator(".ag-row")).not.toHaveCount(semula, { timeout: 10_000 });
    await expect(page.locator(".ag-row").first()).toContainText("Kedungmutih", {
      ignoreCase: true,
    });
  });
});
