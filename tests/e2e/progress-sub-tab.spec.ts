import { test, expect, type Page } from "@playwright/test";

/**
 * PROGRESS LOKASI — empat bagian, dan yang mengatur tidak menghalangi yang
 * memantau (DECISIONS 363).
 *
 * Permintaan user 2026-08-18: *"ikuti dan adopsi desain ini untuk tab progres
 * di lokasi, ini lebih rapi dan tidak scroll panjang jauh ke bawah."*
 *
 * Halaman lama menumpuk delapan kartu — kurva-S, tabel mingguan, prognosa,
 * editor jadwal, penyesuaian %-mingguan, item tertinggal, kendala, dan riwayat
 * baseline — sehingga membaca deviasi berarti menggulir melewati dua editor.
 *
 * Yang diuji: keempat bagian bisa dilihat tanpa menggulir dan tanpa terpotong,
 * halaman tidak lagi merender semuanya sekaligus, dan mendarat di halaman ini
 * berarti mendarat di bagian PANTAU — bukan di editor.
 */

const LOKASI = process.env.E2E_SLUG_RAB ?? "kedungmutih";

async function login(page: Page, username = "admin") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 });
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Bagian Progress" });

const LABEL = [
  "Ringkasan Progress",
  "Kurva-S & Baseline",
  "Jadwal Pekerjaan",
  "Tertinggal & Kendala",
];

test.describe("Progress lokasi — sub-tab", () => {
  test("keempat bagian terlihat utuh TANPA menggulir", async ({ page }) => {
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
    await page.goto(`/lokasi/${LOKASI}/progress`);
    await nav(page).waitFor({ timeout: 20_000 });

    const { width: lebarLayar, height: tinggiLayar } = page.viewportSize()!;
    for (const label of LABEL) {
      const kotak = await nav(page).getByRole("link", { name: label }).boundingBox();
      expect(kotak, `${label} tidak ditemukan`).not.toBeNull();
      expect(kotak!.y + kotak!.height, `${label} di bawah lipatan`).toBeLessThanOrEqual(tinggiLayar);
      expect(kotak!.x, `${label} terpotong kiri`).toBeGreaterThanOrEqual(0);
      expect(kotak!.x + kotak!.width, `${label} terpotong kanan`).toBeLessThanOrEqual(lebarLayar);
    }
  });

  test("mendarat di bagian PANTAU, bukan di editor", async ({ page }) => {
    // Memantau jauh lebih sering daripada mengatur. Mendaratkan orang di editor
    // baseline adalah kebalikan dari yang ia cari saat membuka tab Progress.
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress`);
    await expect(nav(page).getByRole("link", { name: "Ringkasan Progress" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Rencana vs realisasi per minggu")).toBeVisible();
  });

  test("editor jadwal & riwayat baseline TIDAK ikut dirender di ringkasan", async ({ page }) => {
    // Bukan soal kerapian: keduanya menarik kueri sendiri dan mengirim
    // komponen klien yang berat. Kalau semuanya kembali dirender bersamaan,
    // halamannya kembali panjang dan lambat sekaligus.
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress`);
    await nav(page).waitFor({ timeout: 20_000 });
    await expect(page.getByText("Riwayat baseline")).toHaveCount(0);
    await expect(page.getByText("Penyesuaian halus %-mingguan")).toHaveCount(0);
  });

  test("tiap bagian membuka isinya sendiri", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress`);
    await nav(page).waitFor({ timeout: 20_000 });

    await nav(page).getByRole("link", { name: "Kurva-S & Baseline" }).click();
    await expect(page).toHaveURL(/bagian=baseline/);
    await expect(page.getByText("Riwayat baseline")).toBeVisible();

    await nav(page).getByRole("link", { name: "Tertinggal & Kendala" }).click();
    await expect(page).toHaveURL(/bagian=kendala/);
    await expect(page.getByText("Item tertinggal")).toBeVisible();

    await nav(page).getByRole("link", { name: "Jadwal Pekerjaan" }).click();
    await expect(page).toHaveURL(/bagian=jadwal/);
  });

  test("bagian ngawur mendarat di ringkasan, bukan halaman kosong", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress?bagian=ngawur`);
    await expect(nav(page).getByRole("link", { name: "Ringkasan Progress" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
