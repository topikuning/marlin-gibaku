import { test, expect, type Page } from "@playwright/test";

/**
 * DUA ATURAN UX katalog lokasi yang diminta user 2026-08-19 (DECISIONS 368):
 *
 *  1. Koordinat boleh kosong — lokasinya TETAP tersimpan, tapi diberi status
 *     "Perlu verifikasi".
 *  2. Sebelum menyimpan, sistem memeriksa duplikasi berdasarkan kombinasi
 *     wilayah, supaya tidak lahir lokasi ganda.
 *
 * Uji unit sudah menjaga logikanya (`master-lokasi-duplikat.test.ts`). Yang
 * dijaga DI SINI adalah hal yang tidak bisa dibuktikan uji murni: bahwa
 * pemeriksaan itu benar-benar TERPASANG di jalur simpan, dan bahwa penolakannya
 * sampai ke layar sebagai kalimat yang bisa ditindaklanjuti — bukan galat
 * unique-constraint mentah dari basis data.
 */

/** Nama desa unik per proses uji: baris yang dibuat uji ini menetap di DB. */
const unik = `Ujicoba ${process.env.HOSTNAME ?? "lokal"}-${Date.now().toString(36)}`;

async function bukaKatalog(page: Page): Promise<void> {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("admin");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  await page.goto("/master/lokasi", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Total katalog", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function isiWilayah(
  page: Page,
  w: { provinsi: string; kabupaten: string; kecamatan?: string; desa: string },
): Promise<void> {
  await page.getByLabel("Provinsi *").fill(w.provinsi);
  await page.getByLabel("Kabupaten / Kota *").fill(w.kabupaten);
  if (w.kecamatan) await page.getByLabel("Kecamatan", { exact: true }).fill(w.kecamatan);
  await page.getByLabel("Desa / Kelurahan *").fill(w.desa);
}

test.describe("Katalog Lokasi — tambah manual", () => {
  test.beforeEach(async ({ page }) => {
    await bukaKatalog(page);
    await page.getByRole("button", { name: "Tambah Lokasi" }).click();
    await expect(page.getByRole("dialog", { name: "Tambah Lokasi" })).toBeVisible();
  });

  test("wilayah yang sudah ada DITAHAN, dengan kandidatnya disebut", async ({ page }) => {
    /*
     * Sumberkima (Gerokgak, Buleleng, Bali) ada di seed. Diketik dengan huruf
     * kecil semua supaya sekalian terbukti pembandingnya tidak bergantung pada
     * cara orang mengetik.
     */
    await isiWilayah(page, {
      provinsi: "bali",
      kabupaten: "buleleng",
      kecamatan: "gerokgak",
      desa: "sumberkima",
    });
    await page.getByRole("button", { name: "Simpan Lokasi" }).click();

    await expect(page.getByText(/sudah ada — tidak dibuat ganda/i)).toBeVisible({ timeout: 20_000 });
    /*
     * Kandidatnya DISEBUT, bukan cuma ditolak: penolakan tanpa menunjukkan
     * yang mana memaksa orang mencari sendiri di daftar 73 baris.
     *
     * Dicari DI DALAM laci. Halaman ini merender daftarnya dua kali — tabel
     * untuk layar lebar, kartu untuk ponsel — jadi `getByText(...).first()` di
     * lingkup halaman bisa mengenai salinan yang sedang disembunyikan CSS dan
     * gagal dengan "hidden" yang tidak ada hubungannya dengan yang diuji.
     */
    const laci = page.getByRole("dialog", { name: "Tambah Lokasi" });
    await expect(laci.getByText("Sumberkima")).toBeVisible();
    // Dan untuk yang sama persis, TIDAK ada jalan memaksa — indeks unik basis
    // data akan menolaknya, jadi menjanjikannya berakhir dengan galat mentah.
    await expect(page.getByRole("button", { name: "Tetap simpan sebagai baru" })).toHaveCount(0);
  });

  test("koordinat kosong tetap tersimpan, dan statusnya disebut", async ({ page }) => {
    const desa = `${unik} A`;
    await isiWilayah(page, {
      provinsi: "Nusa Tenggara Timur",
      kabupaten: "Sikka",
      kecamatan: "Alok",
      desa,
    });
    await page.getByRole("button", { name: "Simpan Lokasi" }).click();

    // Bukan galat: tersimpan, DAN akibatnya dikatakan.
    await expect(page.getByText(/tersimpan tanpa koordinat/i)).toBeVisible({ timeout: 20_000 });

    /*
     * Lalu dibuktikan di DAFTARNYA, bukan dari kalimat sukses saja.
     *
     * Versi pertama uji ini berhenti pada `getByText(/Perlu verifikasi/)` —
     * dan itu juga cocok dengan teks bantuan yang memang tertulis di formulir
     * ("...diberi status Perlu verifikasi..."). Ujinya akan tetap hijau
     * seandainya tidak ada satu baris pun tersimpan.
     */
    await page.getByRole("button", { name: "Tutup" }).last().click();
    await expect(page.getByRole("dialog", { name: "Tambah Lokasi" })).toBeHidden();

    /*
     * Disaring ke satu baris, lalu diperiksa apa yang TERLIHAT.
     *
     * `filter({ visible: true })` bukan kehati-hatian berlebih: daftarnya
     * dirender dua kali (tabel `max-sm:hidden` + kartu `sm:hidden`), jadi
     * hitungan tanpa saringan itu selalu dua dan `.first()` bisa mengenai
     * salinan yang sedang disembunyikan.
     */
    await page.getByPlaceholder(/Cari desa, kecamatan/i).fill(desa);

    /*
     * Dibatasi ke DAFTARNYA. "Perlu verifikasi" memang tertulis di beberapa
     * tempat lain di halaman ini — kartu KPI dan opsi saringan — dan itu benar,
     * bukan sesuatu yang perlu dihindari. Yang harus dipastikan uji ini adalah
     * BARISNYA yang berstatus begitu.
     */
    const daftar = page.getByRole("region", { name: "Daftar lokasi" });
    await expect(daftar.getByText(desa).filter({ visible: true })).toHaveCount(1, { timeout: 20_000 });
    await expect(daftar.getByText("Perlu verifikasi").filter({ visible: true })).toHaveCount(1);
    await expect(daftar.getByText("belum diisi").filter({ visible: true })).toHaveCount(1);
  });

  test("separuh koordinat ditolak — lintang tanpa bujur bukan tempat", async ({ page }) => {
    await isiWilayah(page, {
      provinsi: "Nusa Tenggara Timur",
      kabupaten: "Sikka",
      kecamatan: "Alok",
      desa: `${unik} B`,
    });
    await page.getByLabel("Lintang (latitude)").fill("-8.62");
    await page.getByRole("button", { name: "Simpan Lokasi" }).click();

    /*
     * Kalimat yang dicari SENGAJA yang hanya ada di banner galat.
     *
     * Versi pertama mencari "kosongkan keduanya" — yang juga tertulis di teks
     * bantuan di bawah kolom koordinat. Ujinya hijau tanpa membuktikan galatnya
     * muncul; ia baru ketahuan ketika banner-nya benar-benar terbit dan
     * Playwright mengeluh dua elemen cocok.
     */
    await expect(page.getByText(/Isi lintang DAN bujur/)).toBeVisible({ timeout: 20_000 });
  });

  test("koordinat di luar Indonesia ditolak dengan sebabnya", async ({ page }) => {
    // Lintang & bujur tertukar adalah salah ketik paling lazim, dan hasilnya
    // titik di tengah laut yang tidak ada yang memeriksanya lagi.
    await isiWilayah(page, {
      provinsi: "Nusa Tenggara Timur",
      kabupaten: "Sikka",
      kecamatan: "Alok",
      desa: `${unik} C`,
    });
    await page.getByLabel("Lintang (latitude)").fill("122.2");
    await page.getByLabel("Bujur (longitude)").fill("-8.62");
    await page.getByRole("button", { name: "Simpan Lokasi" }).click();

    await expect(page.getByText(/tertukar dengan bujur/i)).toBeVisible({ timeout: 20_000 });
  });
});
