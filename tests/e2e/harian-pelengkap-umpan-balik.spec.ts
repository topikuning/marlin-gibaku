import { test, expect, type Page } from "@playwright/test";

/**
 * MENYIMPAN PELENGKAP HARUS MENGATAKAN BAHWA IA TERSIMPAN.
 *
 * Keluhan lapangan user 2026-08-08: "aku sudah input material dan alat, tapi
 * sama sekali tidak muncul apa pun". Datanya sebenarnya MASUK — yang tidak ada
 * adalah kabarnya.
 *
 * Sebabnya halus. Badan form pelengkap sengaja dipasang ulang saat tanda-tangan
 * isinya berubah, supaya id baris material/alat yang baru dibuat server masuk ke
 * input tersembunyi (tanpa itu penyimpanan berikutnya membuat ulang barisnya dan
 * fotonya lepas — DECISIONS 304). Tapi pemasangan ulang juga menghapus state
 * `useActionState`, jadi kotak "tersimpan" musnah sebelum sempat terbaca.
 *
 * Yang jahat: ini HANYA terjadi saat daftar id BERUBAH — yaitu tepat pada
 * pengisian material/alat yang PERTAMA. Menyimpan untuk kedua kalinya (id sudah
 * sama) memunculkan kabarnya dengan normal. Jadi bug ini tak terlihat oleh siapa
 * pun yang menguji dengan menekan Simpan dua kali.
 *
 * Karena itu uji ini WAJIB mulai dari laporan yang belum punya material sama
 * sekali, dan hanya menyimpan SEKALI. Diuji lewat browser sungguhan: yang diuji
 * adalah apa yang terlihat orang setelah menekan tombol.
 */

const SLUG = process.env.E2E_SLUG ?? "kedungmutih";

async function login(page: Page, username: string, password = "marlin123") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Tanggal kerja hari ini di Asia/Jakarta — sama dengan yang dipakai server. */
function hariIniJakarta() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test.describe("umpan balik simpan pelengkap", () => {
  test("mengisi material PERTAMA kali tetap memunculkan kabar tersimpan", async ({ page }) => {
    await login(page, "sm-01");
    await page.goto(`/lokasi/${SLUG}/harian/${hariIniJakarta()}`);

    await expect(page.locator('input[name="materialName"]').first()).toBeVisible({
      timeout: 15_000,
    });

    /*
     * Baris BARU, bukan baris pertama. Syarat munculnya bug adalah daftar id
     * material BERUBAH oleh penyimpanan ini — menambah baris selalu memenuhi
     * itu, apa pun sisa data dari jalan sebelumnya. Mengosongkan-lalu-menyimpan
     * dulu juga memenuhinya, tapi menuntut dua penyimpanan beruntun: yang kedua
     * bisa mengetik ke form yang sedang dipasang ulang oleh yang pertama, dan
     * ketikannya hilang. Itu kerapuhan uji, bukan kerapuhan produk.
     */
    const nama = `Semen uji ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "Tambah material" }).click();
    const baris = page.locator('input[name="materialName"]').last();
    await baris.fill(nama);
    await page.locator('input[name="materialUnit"]').last().fill("zak");
    await page.locator('input[name="materialQty"]').last().fill("20");
    await page.getByRole("button", { name: "Simpan Pelengkap" }).click();

    // Kabar harus TETAP terlihat, bukan berkelebat lalu hilang.
    await expect(page.getByText("Pelengkap laporan tersimpan.").first()).toBeVisible({
      timeout: 15_000,
    });

    // …dan datanya memang tersimpan (kabar tanpa data lebih buruk daripada
    // tidak ada kabar sama sekali). Baris diurutkan menurut nama oleh server,
    // jadi yang dicari adalah KEBERADAANNYA, bukan posisinya.
    await expect(page.locator(`input[name="materialName"][value="${nama}"]`)).toHaveCount(1, {
      timeout: 15_000,
    });
    /*
     * Dulu di sini diperiksa keberadaan kartu "Foto material & alat" — kartu
     * TERPISAH di bawah form (DECISIONS 304). Kartu itu sudah tidak ada:
     * pemicunya kini menempel pada barisnya sendiri (DECISIONS 341), justru
     * karena kartu jauh di bawah itulah yang membuat orang tidak tahu foto
     * material bisa ditambahkan.
     *
     * Yang diperiksa sekarang hal yang SAMA maksudnya: sesudah tersimpan, baris
     * itu menawarkan jalan menambahkan fotonya. Bergantung lingkungan — tanpa
     * R2 penyimpanan foto memang mati dan kontrolnya sengaja tidak ditawarkan.
     */
    const fotoMati = (await page.getByText(/Penyimpanan foto .*belum diaktifkan/i).count()) > 0;
    if (fotoMati) {
      await expect(page.locator('button[aria-label^="Foto untuk"]')).toHaveCount(0);
    } else {
      await expect(page.locator(`button[aria-label="Foto untuk ${nama}"]`)).toBeVisible();
    }
  });
});
