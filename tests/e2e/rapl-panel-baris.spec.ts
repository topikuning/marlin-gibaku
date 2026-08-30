import { test, expect, type Page } from "@playwright/test";

/**
 * RAPL: mengetuk baris grid harus memunculkan panelnya DI LAYAR.
 *
 * Ditulis merah lebih dulu. Sebelum perbaikan, keempat uji di bawah gagal, dan
 * masing-masing gagal karena sebab yang berbeda:
 *
 *  1. **Validasi breakdown** — panelnya memang dirender, tapi SESUDAH grid
 *     setinggi 55vh plus bar paginasi. Di layar laptop ia mulai kira-kira satu
 *     layar penuh di bawah lipatan, sementara satu-satunya umpan balik di
 *     tempat mata pengguna berada adalah garis fokus sel AG Grid. Pelapornya
 *     bukan alat uji: "saat atas diklik tidak memunculkan apapun, kalau tidak
 *     scroll bawah, tidak akan sadar penggunanya."
 *  2. **Rincian per item** — panelnya tidak muncul SAMA SEKALI. Gridnya
 *     mengoper `rowLink` bersama `onRowClicked`, dan di `MarlinGrid` `rowLink`
 *     memotong lebih dulu lalu `return`, jadi `onRowClicked` tidak pernah
 *     dipanggil. Barisnya tidak punya tautan, sehingga ketukannya berhenti
 *     tanpa suara — seluruh isi panel (tambah komponen, faktor konversi, harga
 *     borongan) tak terjangkau.
 *  3. **Papan tik** — `MarlinGrid` tidak memasang `onCellKeyDown`. Event
 *     `rowClicked` AG Grid lahir dari tetikus/sentuhan saja; Enter di sel tidak
 *     memicunya. Artinya pengguna papan tik tidak punya jalan apa pun ke panel
 *     ini (WCAG 2.1.1, Level A).
 *  4. **Escape + kembalinya fokus** — `PanelGeser` memindahkan fokus ke dalam
 *     panel tapi tidak mengembalikannya saat ditutup, jadi fokus jatuh ke
 *     `<body>` dan penelusuran papan tik harus dimulai dari awal halaman.
 *
 * Yang diuji SELALU dari titik masuk yang dipakai orang — ketukan dan tombol —
 * bukan dari state komponen. Panel yang "ada di DOM" tapi di luar viewport
 * lolos pemeriksaan keberadaan dan tetap gagal dipakai; karena itu dipakai
 * `toBeInViewport()`, bukan `toBeVisible()` saja.
 *
 * Prasyarat: `pnpm db:seed` (kedungmutih punya revisi RAB aktif).
 */

const SLUG = "kedungmutih";

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 10_000 }).catch(() => {});
}

/** Sel pertama baris pertama — sasaran ketukan yang sama dengan jari pengguna. */
function selPertama(page: Page) {
  return page.locator(".ag-center-cols-container .ag-row").first().locator(".ag-cell").first();
}

async function bukaBagian(page: Page, bagian: string) {
  await page.goto(`/lokasi/${SLUG}/rapl?bagian=${bagian}`);
  await expect(selPertama(page)).toBeVisible({ timeout: 15_000 });
}

test.describe("RAPL: panel baris muncul di layar", () => {
  test("validasi breakdown – ketukan baris memunculkan panel di dalam viewport", async ({ page }) => {
    await login(page, "admin");
    await bukaBagian(page, "validasi");

    await selPertama(page).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    // Inti keluhannya: bukan "ada di halaman", tapi "ada di layar".
    await expect(panel).toBeInViewport();
  });

  test("rincian per item – panel rinciannya bisa dibuka dari baris", async ({ page }) => {
    await login(page, "admin");
    await bukaBagian(page, "rincian");

    await selPertama(page).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport();
  });

  test("papan tik – Enter pada sel membuka panel yang sama", async ({ page }) => {
    await login(page, "admin");
    await bukaBagian(page, "validasi");

    await selPertama(page).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Escape menutup panel dan mengembalikan fokus ke baris asalnya", async ({ page }) => {
    await login(page, "admin");
    await bukaBagian(page, "validasi");

    await selPertama(page).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Fokus kembali ke tempat asalnya — kalau jatuh ke <body>, pengguna papan
    // tik harus menelusuri ulang seluruh halaman untuk kembali ke barisnya.
    await expect(selPertama(page)).toBeFocused();
  });
});
