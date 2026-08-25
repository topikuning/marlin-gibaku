import { test, expect, type Page } from "@playwright/test";

/**
 * IDENTITAS BARIS TIDAK BOLEH HANYUT SAAT TABEL DIGULIR MENDATAR.
 *
 * Keluhan user 2026-08-12: *"ketika scroll ke kanan/kiri, tidak tahu itu data
 * progress lokasi mana."* Daftar lokasi lebih lebar dari satu layar, jadi begitu
 * digulir ke kanan yang tersisa hanya deretan angka tanpa pemiliknya — dan angka
 * progres tanpa nama lokasi bukan sekadar tidak berguna, tapi berbahaya: paling
 * mudah dibaca sebagai milik lokasi yang salah.
 *
 * Diuji lewat browser sungguhan karena yang diuji adalah AKIBAT MENGGULIR.
 * Tidak ada uji unit yang bisa membuktikannya: kolom yang "dikunci" menurut
 * definisi kolom belum tentu tetap terkunci menurut AG Grid. Terbukti saat
 * memperbaikinya — dengan dua kolom terkunci berdampingan (340 px), pada
 * viewport ponsel AG Grid MELEPAS kunci kolom Lokasi diam-diam, dan yang
 * menempel di kiri justru Wilayah. Definisi kolomnya tampak benar; layarnya
 * tidak. Karena itu ujinya menggulir sungguhan lalu memeriksa apa yang terlihat.
 */

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 30_000 });
}

/** Elemen yang benar-benar menggulir mendatar di AG Grid 36. */
const PENGGULIR = ".ag-body-horizontal-scroll-viewport";

test.describe("daftar lokasi – identitas terkunci di kiri", () => {
  test("nama lokasi + wilayah tetap terbaca sesudah digulir mentok ke kanan", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/lokasi");

    const sel = page.locator(".ag-row").first().locator(".ag-cell").first();
    await expect(sel).toBeVisible({ timeout: 30_000 });
    const sebelum = (await sel.innerText()).trim();
    // Sel identitas memuat DUA keterangan: nama lokasi dan wilayahnya.
    expect(sebelum.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(2);

    const bisaDigulir = await page.evaluate(
      (s) => {
        const e = document.querySelector(s);
        return e ? e.scrollWidth - e.clientWidth : 0;
      },
      PENGGULIR,
    );
    // Kalau tabelnya tidak bisa digulir, ujinya tidak membuktikan apa pun.
    expect(bisaDigulir, "tabel harus lebih lebar dari layar agar uji ini berarti").toBeGreaterThan(50);

    await page.evaluate(
      (s) => {
        const e = document.querySelector(s);
        if (e) e.scrollLeft = e.scrollWidth;
      },
      PENGGULIR,
    );
    await expect
      .poll(async () => page.evaluate((s) => document.querySelector(s)?.scrollLeft ?? 0, PENGGULIR))
      .toBeGreaterThan(50);

    // Isi sel identitas tidak berubah DAN masih terlihat di layar.
    await expect(sel).toBeVisible();
    expect((await sel.innerText()).trim()).toBe(sebelum);
    // Dibandingkan dengan tepi kiri GRID-nya, bukan tepi layar: di desktop ada
    // bilah navigasi di kiri, jadi grid mulai jauh dari x=0 dan patokan absolut
    // akan salah menuduh.
    const kotak = (await sel.boundingBox())!;
    const grid = (await page.locator(".ag-root-wrapper").first().boundingBox())!;
    expect(kotak.x - grid.x, "sel identitas harus tetap menempel di tepi kiri grid").toBeLessThan(8);
    expect(kotak.width).toBeGreaterThan(100);

    // Dan yang di sebelahnya memang sudah tergulir — bukan tabel yang diam.
    const kolomTerakhir = page.locator(".ag-header-cell").last();
    await expect(kolomTerakhir).toBeVisible();
  });

  test("baris TERAKHIR tidak terpotong oleh lajur penggulir mendatar", async ({ page }) => {
    /*
     * AG Grid menaruh lajur penggulir mendatarnya MENUMPANG di dasar badan
     * grid, jadi ia menutupi 16 px terakhir baris terakhir. Dengan sel dua
     * baris, itu memakan baris wilayah pada baris paling bawah — hanya baris
     * terakhir, hanya kalau tabelnya bisa digulir mendatar. Cacat yang mudah
     * lolos justru karena sempit dan cuma di satu baris.
     */
    await login(page, "admin");
    await page.goto("/lokasi");
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 30_000 });

    const bersih = await page.evaluate(() => {
      const baris = [...document.querySelectorAll(".ag-row")];
      const isi = baris.at(-1)?.querySelector(".ag-cell")?.firstElementChild;
      // `.ag-body-horizontal-scroll` yang pertama adalah PEMBUNGKUS setinggi
      // seluruh badan grid — memakainya membuat perbandingan ini tak berarti.
      // Yang benar-benar selebar 16 px di dasar adalah viewport-nya.
      const lajur = document.querySelector(".ag-body-horizontal-scroll-viewport");
      if (!isi || !lajur) return null;
      return isi.getBoundingClientRect().bottom <= lajur.getBoundingClientRect().top + 0.5;
    });
    expect(bersih, "isi sel baris terakhir harus berhenti sebelum lajur penggulir").toBe(true);
  });
});
