import { expect, test, type Page } from "@playwright/test";

/**
 * PENANDA SIBUK DI SELURUH APLIKASI (DECISIONS 401).
 *
 * Permintaan user 2026-08-21: *"ya semua yang diklik berpotensi butuh waktu
 * (tidak instant) gunakan penanda sibuk! common sense kan!"*
 *
 * Uji ini menjaga MEKANISME-nya, di peramban sungguhan. Penjaga statis
 * (`tests/unit/penanda-sibuk.test.ts`) memastikan setiap tempat memakai jalur
 * yang benar; yang tidak bisa dibuktikan di sana adalah bahwa jalur itu
 * benar-benar MENYALA. Persis jarak itulah yang meloloskan cacatnya tiga kali:
 * `useActionState` dipakai, `loading` diteruskan, uji unit hijau — dan
 * `pending`-nya tidak pernah `true` sedetik pun.
 *
 * Semua penyaring dan aksi klik di aplikasi ini bertumpu pada `pending` milik
 * `useTransition` (lewat `useAksiKlik`, `FormSaring`, atau `startTransition`
 * langsung). Membuktikannya menyala pada satu layar membuktikan mekanismenya,
 * bukan cuma satu layar itu.
 */

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/**
 * Jaringan diperlambat sesudah halaman siap.
 *
 * Tanpa ini uji berikut akan selalu lulus di CI yang cepat tanpa menjaga apa
 * pun: penandanya menyala lalu padam dalam satu frame, dan `toBeVisible` bisa
 * meleset ke celah itu. Pola yang sama dipakai `mobile-umpan-balik-navigasi`.
 */
async function perlambat(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test.describe("penyaring mengaku sedang menyaring", () => {
  test("galeri Foto: tombol Terapkan berubah jadi Menyaring…", async ({ page }) => {
    await login(page);
    await page.goto("/foto");
    const terapkan = page.getByRole("button", { name: /Terapkan|Menyaring/ });
    await expect(terapkan).toBeVisible({ timeout: 30_000 });

    await perlambat(page, 700);
    await terapkan.click();
    await expect(page.getByRole("button", { name: /Menyaring/ })).toBeVisible({ timeout: 10_000 });
  });

  test("papan Kendala: tombol Cari berubah jadi Menyaring…", async ({ page }) => {
    await login(page);
    await page.goto("/kendala");
    const cari = page.getByRole("button", { name: /^(Cari|Menyaring)/ });
    await expect(cari).toBeVisible({ timeout: 30_000 });

    /*
     * Kotak carinya DIISI dulu. Menekan "Cari" dengan kotak kosong mendorong
     * URL yang sama persis, dan perpindahan ke alamat yang tidak berubah tidak
     * pernah menerbitkan Transition — ujinya akan merah karena keadaan yang
     * memang tidak menuntut penanda apa pun, bukan karena penandanya hilang.
     * (Versi pertama uji ini memerah persis begitu.)
     */
    await page.locator("#f-cari").fill("lahan");

    await perlambat(page, 700);
    await cari.click();
    await expect(page.getByRole("button", { name: /Menyaring/ })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("tombol unduh mengaku sedang menyiapkan", () => {
  test("Progress: Unduh Excel jadwal menyalakan penandanya", async ({ page }) => {
    /*
     * Dulu jalur `ButtonLink unduhan` justru SENGAJA mematikan bar progres
     * navigasi (benar alasannya – unduhan tidak mengganti pathname), sehingga
     * ia jadi satu-satunya aksi yang dirancang tanpa penanda apa pun.
     */
    await login(page);
    await page.goto("/lokasi/batah-timur/progress");

    const unduh = page.getByRole("link", { name: /Unduh Excel|Menyiapkan Excel/ }).first();
    await expect(unduh).toBeVisible({ timeout: 30_000 });

    const unduhan = page.waitForEvent("download", { timeout: 60_000 });
    await unduh.click();
    await expect(page.getByRole("status")).toContainText(/Menyiapkan/i, { timeout: 10_000 });

    const berkas = await unduhan;
    expect(await berkas.suggestedFilename()).toMatch(/\.(xlsx|xls)$/i);
  });
});
