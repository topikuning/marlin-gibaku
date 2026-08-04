import { test, expect, type Page } from "@playwright/test";

/**
 * KONTROL FORM TIDAK BOLEH MEMICU AUTO-ZOOM iOS (DECISIONS 246).
 *
 * Keluhan user 2026-08-04: *"tiap kali login pertama kali, tampilan di mobile
 * seperti ini. harus zoom out manual supaya tampilannya pas."* — berikut
 * tangkapan layar Dashboard Eksekutif yang terpotong di kiri, kanan, dan bawah.
 *
 * Penyebabnya bukan di halaman tujuan. Safari iOS MEMPERBESAR halaman begitu
 * fokus masuk ke kontrol form yang font-nya di bawah 16px, dan zoom itu TIDAK
 * dikembalikan sesudah fokus lepas — ia terbawa ke halaman berikutnya. Jadi
 * yang memicunya ketukan ke kolom username di `/masuk`; dashboard hanya
 * mewarisi zoomnya. Karena itu keluhannya berbunyi "tiap kali login PERTAMA
 * KALI": hanya di situ ada input yang diketuk sebelum mendarat di dashboard.
 *
 * `globals.css` sudah memasang aturan 16px untuk layar kecil, tapi di
 * `@layer base` — dan di Tailwind 4 utility SELALU menang atas base, sehingga
 * `text-sm` pada komponen input membatalkannya tanpa suara. Pagar yang terlihat
 * ada padahal tidak berlaku justru lebih berbahaya daripada tidak ada pagar,
 * dan itulah yang dijaga berkas ini: bukan ada-tidaknya aturan CSS, melainkan
 * **font-size TERHITUNG** pada elemen sungguhan di viewport ponsel.
 */

/** Ambang Safari iOS. Di bawah ini halaman diperbesar saat fokus. */
const MIN_PX = 16;

async function ukurFont(page: Page): Promise<{ nama: string; px: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((el) => !(el instanceof HTMLInputElement && el.type === "hidden"))
      .map((el) => ({
        nama:
          (el as HTMLInputElement).name ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.tagName.toLowerCase(),
        px: parseFloat(getComputedStyle(el).fontSize),
      })),
  );
}

function laporkan(kontrol: { nama: string; px: number }[]): string {
  return kontrol
    .filter((k) => k.px < MIN_PX)
    .map((k) => `  "${k.nama}" = ${k.px}px`)
    .join("\n");
}

test.describe("kontrol form ≥16px di ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("halaman login — sumber zoom yang terbawa ke dashboard", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "perilaku khusus ponsel");
    await page.goto("/masuk");
    const kontrol = await ukurFont(page);

    expect(kontrol.length, "halaman login harus punya kolom isian").toBeGreaterThan(0);
    expect(
      laporkan(kontrol),
      "Kontrol di bawah 16px membuat Safari iOS memperbesar halaman saat difokus, " +
        "dan zoomnya TERBAWA ke halaman sesudah login:",
    ).toBe("");
  });

  test("form dalam aplikasi juga aman", async ({ page }) => {
    // Bukan cuma login: tiap form yang diketuk di ponsel meninggalkan zoom yang
    // sama untuk layar berikutnya.
    test.skip(test.info().project.name !== "mobile", "perilaku khusus ponsel");
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });

    await page.goto("/lokasi", { waitUntil: "domcontentloaded" });
    /*
     * TUNGGU GRID SIAP dulu. AG Grid menggambar panel paginasi (berikut kotak
     * nomor halamannya) SESUDAH mount, jadi mengukur tepat setelah `goto`
     * berarti mengukur halaman yang kontrolnya belum semua ada — dan uji ini
     * lulus bukan karena aman, melainkan karena belum melihat.
     *
     * Persis itu yang terjadi: di mesin lokal uji ini lulus, sementara CI
     * menangkap kotak nomor halaman AG Grid pada 13px. Menunggu grid membuat
     * hasilnya sama di mana pun dijalankan.
     */
    await page.locator(".ag-root-wrapper").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator(".ag-paging-panel").first().waitFor({ state: "visible", timeout: 30_000 });
    const kontrol = await ukurFont(page);
    test.skip(kontrol.length === 0, "tidak ada kontrol form di halaman ini");
    expect(laporkan(kontrol), "Kontrol di bawah 16px memicu zoom Safari iOS:").toBe("");
  });
});
