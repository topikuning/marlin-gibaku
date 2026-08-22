import { expect, test, type Page } from "@playwright/test";

/**
 * PINDAH TANGGAL LAPORAN HARIAN — DI LAYAR (DECISIONS 415).
 *
 * User 2026-08-22: *"ini terlalu ribet untuk edit, padahal bisa sekali klik,
 * ganti tanggal saja. kalau ada fitur khusus di superadmin bisa pindah tanggal,
 * akan sangat efektif."*
 *
 * ### Yang harus E2E, dan kenapa
 *
 * Tiga hal yang tidak bisa dibuktikan uji lain:
 *
 *  1. **Siapa yang melihat tombolnya.** `can()` sudah diuji murni, tapi yang
 *     menentukan aman-tidaknya adalah apakah halamannya benar-benar tidak
 *     merendernya untuk peran lain – bukan apakah fungsinya mengembalikan
 *     `false`.
 *  2. **Tanggal yang dieja.** `<input type="date">` menampilkan urutan angka
 *     menurut bahasa PERAMBAN. Hanya peramban sungguhan yang bisa menunjukkan
 *     bahwa ejaannya ikut berubah saat pilihannya diganti.
 *  3. **Isian yang bertahan setelah DITOLAK.** React mengosongkan medan tak
 *     terkendali setiap kali aksi server selesai, termasuk saat ditolak. Cacat
 *     ini muncul HANYA di peramban, dan ketahuan justru saat dijalankan – bukan
 *     saat dibaca.
 */

const LOKASI = "kedungmutih";

async function masuk(page: Page, user: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(user);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Tanggal yang PUNYA laporan – diambil dari kalender, bukan dikarang. */
async function tanggalBerisi(page: Page): Promise<string> {
  await page.goto(`/lokasi/${LOKASI}/harian`);
  const href = await page
    .getByRole("group", { name: "Petak tanggal" })
    .locator("a")
    .filter({ hasText: /item/ })
    .first()
    .getAttribute("href");
  const tgl = href?.match(/tgl=(\d{4}-\d{2}-\d{2})/)?.[1];
  expect(tgl, "kalender harus punya minimal satu tanggal berisi").toBeTruthy();
  return tgl!;
}

const pemicu = (page: Page) =>
  page.getByRole("button", { name: /Salah tanggal\? Pindahkan laporan ini/ });

test.describe("pindah tanggal laporan", () => {
  test("hanya super admin yang melihat pintunya", async ({ page }) => {
    const tgl = await (async () => {
      await masuk(page, "admin");
      return tanggalBerisi(page);
    })();

    await page.goto(`/lokasi/${LOKASI}/harian/${tgl}`);
    await expect(pemicu(page)).toBeVisible({ timeout: 20_000 });

    /*
     * Peran lain: bukan sekadar tombolnya tidak terlihat – teksnya TIDAK BOLEH
     * ADA di halaman sama sekali. Menyembunyikan dengan CSS meninggalkan
     * formulir yang tetap bisa ditemukan & dikirim orang; yang menjaga
     * sebenarnya tetap server action, tapi merender pintunya untuk orang yang
     * tidak boleh masuk cuma menghasilkan penolakan yang membingungkan.
     */
    for (const user of ["hery", "sm-01"]) {
      const ctx = await page.context().browser()!.newContext();
      const p2 = await ctx.newPage();
      await masuk(p2, user);
      await p2.goto(`/lokasi/${LOKASI}/harian/${tgl}`);
      await p2.waitForLoadState("networkidle");
      await expect(pemicu(p2), user).toHaveCount(0);
      expect(await p2.content(), user).not.toContain("Pindahkan laporan ini");
      await ctx.close();
    }
  });

  test("tanggal DIEJA dalam bahasa Indonesia, dan ikut berubah", async ({ page }) => {
    /*
     * 08/09/2026 berarti 8 September di peramban berbahasa Inggris dan 9
     * Agustus di peramban berbahasa Indonesia. Angka yang sama, dua hari yang
     * berbeda — pada formulir yang justru ada karena tanggalnya pernah salah.
     */
    await masuk(page, "admin");
    const tgl = await tanggalBerisi(page);
    await page.goto(`/lokasi/${LOKASI}/harian/${tgl}`);
    await pemicu(page).click();

    const form = page.locator("form").filter({ hasText: "Pindahkan laporan ke tanggal lain" });
    const kotak = form.locator('input[type="date"]');
    const ejaan = form.locator('input[type="date"] + p');

    const sebelum = await ejaan.innerText();
    expect(sebelum).toMatch(/\d{1,2} \w+ \d{4}/);

    await kotak.fill("2026-07-03");
    await expect(ejaan).toHaveText("Jumat, 3 Juli 2026");
  });

  test("penolakan TIDAK menghapus alasan yang sudah diketik", async ({ page }) => {
    /*
     * Ditolak karena tanggal tujuannya sudah berisi — dan itu wajar, orang
     * memang belum tentu hafal tanggal mana yang kosong. Yang tidak wajar:
     * disuruh mengetik ulang alasannya hanya untuk mencoba tanggal lain.
     */
    await masuk(page, "admin");
    const tgl = await tanggalBerisi(page);
    await page.goto(`/lokasi/${LOKASI}/harian/${tgl}`);
    await pemicu(page).click();

    const form = page.locator("form").filter({ hasText: "Pindahkan laporan ke tanggal lain" });
    const alasan = "salah input tanggal pelaksanaan, seharusnya hari berikutnya";
    // Tujuannya SENGAJA tanggal laporan lain yang pasti ada: tanggal berisi itu
    // sendiri sudah pasti terisi, jadi penolakannya terjamin tanpa perlu
    // menebak-nebak isi basis data.
    await form.locator('input[type="date"]').fill(tgl);
    await form.locator("textarea").fill(alasan);
    await form.getByRole("button", { name: "Pindahkan laporan" }).click();

    await expect(form.getByText(/sama dengan tanggal laporan sekarang|sudah punya laporan/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(form.locator("textarea")).toHaveValue(alasan);
  });
});
