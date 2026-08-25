import { expect, test, type Page } from "@playwright/test";

/**
 * MENGETUK TANGGAL HARUS TERLIHAT HASILNYA (DECISIONS 414).
 *
 * Keluhan user 2026-08-22: *"ketika tampilan pas lebar kalender saja, sidebarmu
 * akan berada di bawah, mengakibatkan saat tanggal diklik seakan-akan tidak
 * terjadi apa-apa."*
 *
 * Panelnya `lg:grid-cols-[1fr_320px]`, jadi di bawah `lg` ia jatuh KE BAWAH
 * kalender — di luar layar. Ketukannya bekerja; hasilnya yang tidak terlihat.
 * Dan dari kursi pemakai, "bekerja tapi tak terlihat" tidak bisa dibedakan dari
 * "rusak".
 *
 * ### Yang diuji di sini, dan kenapa harus E2E
 *
 * Pemilihan bentuk (pop-up vs panel samping) diputuskan lebar VIEWPORT dan
 * dijalankan navigasi server. Tidak ada uji unit yang bisa melihat keduanya
 * sekaligus: yang menentukan benar-salahnya adalah apa yang TERLIHAT sesudah
 * ketukan, pada lebar yang sesungguhnya.
 */

const LOKASI = "kedungmutih";

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Petak tanggal yang SUDAH punya laporan – yang membuka ringkasan, bukan formulir. */
const petakBerisi = (page: Page) =>
  page.getByRole("group", { name: "Petak tanggal" }).locator("a").filter({ hasText: /item/ }).first();

const popup = (page: Page) => page.getByRole("dialog");

test.describe("ringkasan tanggal di layar sempit", () => {
  test("ketukan tanggal memunculkan POP-UP, bukan panel di luar layar", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/harian`);

    const petak = petakBerisi(page);
    await expect(petak).toBeVisible({ timeout: 30_000 });
    // Sebelum diketuk tidak ada pop-up – halaman tidak boleh menyambut orang
    // dengan dialog yang tidak ia minta.
    await expect(popup(page)).toHaveCount(0);

    await petak.click();
    await expect(popup(page)).toBeVisible({ timeout: 15_000 });

    /*
     * Isinya harus PERSIS ringkasan yang selama ini ada di panel samping —
     * bukan versi ringkas yang lain. Empat fakta itu yang dipakai orang untuk
     * memutuskan perlu membuka laporannya atau tidak.
     */
    /*
     * Dicari sebagai `term` (<dt>), bukan teks bebas: "Tenaga kerja" muncul DUA
     * kali di panel yang sama — sekali sebagai angka fakta, sekali sebagai
     * baris daftar periksa. Pencarian teks bebas gagal sebagai strict-mode
     * violation, dan itu ujinya yang kurang tepat, bukan panelnya yang salah.
     */
    for (const label of ["Item pekerjaan", "Foto", "Kendala terbuka", "Tenaga kerja"]) {
      await expect(popup(page).getByRole("term").filter({ hasText: label })).toHaveCount(1);
    }

    // Dan membuka laporannya tinggal satu ketukan dari dalam pop-up.
    const buka = popup(page).getByRole("link", { name: /Buka laporan|Lanjutkan input|Perbaiki laporan|Buka tanggal|Buat laporan/ });
    await expect(buka).toBeVisible();
    await buka.click();
    await expect(page).toHaveURL(new RegExp(`/lokasi/${LOKASI}/harian/\\d{4}-\\d{2}-\\d{2}`), {
      timeout: 30_000,
    });
  });

  test("pop-up bisa ditutup, dan URL ikut bersih", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/harian`);
    await petakBerisi(page).click();
    await expect(popup(page)).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("panel=1");

    await page.getByRole("button", { name: "Tutup panel" }).click();
    await expect(popup(page)).toHaveCount(0);
    /*
     * `panel=1` HARUS hilang. Kalau tertinggal, muat ulang halaman akan membuka
     * kembali pop-up yang barusan ditutup orangnya — dan tombol tutup jadi
     * terasa tidak bekerja.
     */
    await expect.poll(() => page.url()).not.toContain("panel=1");
  });

  test("layar lebar TETAP memakai panel samping, tanpa pop-up", async ({ page }) => {
    /*
     * Sisi ini yang membuat perbaikannya proporsional. Di ≥lg panelnya duduk
     * bersebelahan dan ikut terlihat; menggantinya dengan pop-up justru
     * menutupi kalender dan menambah satu ketukan untuk menutupnya.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/harian`);
    await petakBerisi(page).click();
    await page.waitForLoadState("networkidle");

    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByText("Item pekerjaan", { exact: true })).toBeVisible();
  });

  test("alamat ber-panel=1 di layar LEBAR tidak mengunci gulir halaman", async ({ page }) => {
    /*
     * Cacat yang nyaris saya buat: menyembunyikan pop-up dengan `lg:hidden`
     * tetap MENJALANKAN efeknya, termasuk `body.overflow = hidden`. Hasilnya
     * halaman desktop tidak bisa digulir sementara tidak ada panel yang
     * terlihat — cacat yang tidak bersuara sama sekali.
     *
     * Alamatnya diambil dari PETAK sungguhan, bukan dikarang `?panel=1` saja.
     * Versi pertama uji ini memakai `?panel=1` tanpa `tgl`, dan `bukaPanel`
     * memang menuntut keduanya — jadi ia hijau tanpa pernah menyentuh keadaan
     * yang mau dijaga. Ketahuan waktu uji gigi: bentuk yang salah pun lolos.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/harian`);
    const href = await petakBerisi(page).getAttribute("href");
    expect(href).toContain("panel=1");
    expect(href).toContain("tgl=");

    await page.goto(href!);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });
});
