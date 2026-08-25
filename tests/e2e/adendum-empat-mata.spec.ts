import { test, expect, type Cookie, type Page } from "@playwright/test";

/**
 * AKTIVASI ADENDUM BUTUH DUA ORANG (DECISIONS 234) — dibuktikan di browser.
 *
 * Permintaan user 2026-08-03: "pengaktifan adendum harus dua orang, program
 * director dan satu orang di level yang ditugaskan bisa AM/SM/PM, bahkan super
 * admin pun tidak boleh mengaktifkan sendiri."
 *
 * Aturan & gerbangnya sudah diuji unit + integrasi. Yang HANYA bisa dibuktikan
 * di sini: orang yang tidak berhak tidak melihat tombol setuju, tombol aktivasi
 * benar-benar mati sampai dua tanda tangan masuk, dan alasannya terbaca.
 *
 * Prasyarat: DB dev ter-seed, server jalan di baseURL.
 */

const SLUG = process.env.E2E_SLUG_ADENDUM ?? "batah-timur";
const URL = `/lokasi/${SLUG}/rab/adendum`;

/**
 * Sesi di-CACHE per pengguna, bukan login ulang tiap ganti peran.
 *
 * Uji ini berpindah peran belasan kali; kalau tiap perpindahan menembak
 * /masuk, satu berkas ini sendirian menghasilkan ratusan percobaan login.
 * Itu bukan cuma lambat — pembatas laju login (5 percobaan GAGAL per
 * identifier per 15 menit, src/lib/auth/actions.ts) jadi mudah tersentuh oleh
 * kombinasi berkas uji lain, dan kegagalannya menyamar sebagai bug fitur.
 * Cookie sesi tidak terikat perangkat, jadi satu login cukup untuk kedua
 * proyek (desktop + mobile) sepanjang proses uji.
 */
const sesiTersimpan = new Map<string, Cookie[]>();

async function login(page: Page, username: string) {
  await page.context().clearCookies();
  const tersimpan = sesiTersimpan.get(username);
  if (tersimpan) {
    await page.context().addCookies(tersimpan);
    return;
  }
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
  sesiTersimpan.set(username, await page.context().cookies());
}

const tombolAktifkan = (page: Page) => page.getByRole("button", { name: /^Aktifkan draft/ }).first();
const tombolSetuju = (page: Page) => page.getByRole("button", { name: /Setujui aktivasi/i });
const tombolCabut = (page: Page) => page.getByRole("button", { name: /Cabut persetujuan saya/i });

/** Halaman adendum dengan draft siap — dibuat kalau belum ada. */
async function bukaAdendum(page: Page, user: string) {
  await login(page, user);
  await page.goto(URL);
  const buat = page.getByRole("button", { name: /Buat draft/i }).first();
  if (await buat.isVisible().catch(() => false)) {
    await buat.click();
    await expect(tombolAktifkan(page)).toBeVisible({ timeout: 15_000 });
  }
}

/** Bersihkan tanda tangan yang tertinggal dari test sebelumnya. */
async function resetPersetujuan(page: Page) {
  for (const user of ["hery", "pm-01"]) {
    await login(page, user);
    await page.goto(URL);
    if (await tombolCabut(page).isVisible().catch(() => false)) {
      await tombolCabut(page).click();
      await expect(tombolSetuju(page)).toBeVisible({ timeout: 15_000 });
    }
  }
}

test.describe("aktivasi adendum: empat mata", () => {
  test.beforeEach(async ({ page }) => {
    await bukaAdendum(page, "admin");
    await resetPersetujuan(page);
  });

  test("super admin tidak boleh menandatangani, dan tombol aktivasi mati", async ({ page }) => {
    await login(page, "admin");
    await page.goto(URL);
    // Super admin punya capability rab.manage — kalau gerbangnya cuma di
    // capability, tombol ini akan hidup. Yang benar: mati, dan sebabnya ditulis.
    await expect(tombolSetuju(page)).toHaveCount(0);
    await expect(tombolAktifkan(page)).toBeDisabled();
    await expect(tombolAktifkan(page)).toHaveAttribute("title", /Program Director/i);
    await expect(page.getByText(/Masih kurang:/)).toContainText("Program Director");
  });

  test("PD saja belum cukup – masih menunggu AM/PM/SM", async ({ page }) => {
    await login(page, "hery");
    await page.goto(URL);
    await tombolSetuju(page).click();
    await expect(tombolCabut(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Masih kurang:/)).toContainText("Site Manager");
    await expect(tombolAktifkan(page)).toBeDisabled();
  });

  test("PD + Project Manager membuka kunci aktivasi", async ({ page }) => {
    await login(page, "hery");
    await page.goto(URL);
    await tombolSetuju(page).click();
    await expect(tombolCabut(page)).toBeVisible({ timeout: 15_000 });

    await login(page, "pm-01");
    await page.goto(URL);
    await tombolSetuju(page).click();
    await expect(tombolCabut(page)).toBeVisible({ timeout: 15_000 });
    await expect(tombolAktifkan(page)).toBeEnabled();

    // Termasuk bagi super admin: ia tidak boleh menandatangani, tapi setelah
    // dua orang berwenang setuju ia boleh menjalankan aktivasinya.
    await login(page, "admin");
    await page.goto(URL);
    await expect(tombolAktifkan(page)).toBeEnabled();
  });

  test("mencabut satu tanda tangan mengunci ulang", async ({ page }) => {
    await login(page, "hery");
    await page.goto(URL);
    await tombolSetuju(page).click();
    await expect(tombolCabut(page)).toBeVisible({ timeout: 15_000 });

    await login(page, "pm-01");
    await page.goto(URL);
    await tombolSetuju(page).click();
    await expect(tombolAktifkan(page)).toBeEnabled();

    await tombolCabut(page).click();
    await expect(tombolSetuju(page)).toBeVisible({ timeout: 15_000 });
    await expect(tombolAktifkan(page)).toBeDisabled();
  });
});

test.describe("form impor di halaman adendum", () => {
  // Regresi nyata: ImportForm dipanggil tanpa `adaAktif`, jadi bawaannya false
  // dan pilihan "Isi DRAFT adendum" TERKUNCI dengan alasan "Belum ada RAB
  // aktif" — di halaman yang hanya ada KARENA RAB aktifnya ada.
  test("pilihan 'Isi DRAFT adendum' hidup, bukan terkunci dengan alasan terbalik", async ({ page }) => {
    await bukaAdendum(page, "admin");
    const draft = page.getByRole("radio").first();
    await expect(draft).toBeEnabled();
    await expect(draft).toBeChecked();
    await expect(page.getByText(/Belum ada RAB aktif/)).toHaveCount(0);
    // Sebaliknya, "Jadikan RAB AKTIF sekarang" yang harus terkunci di sini.
    await expect(page.getByRole("radio").nth(1)).toBeDisabled();
  });
});
