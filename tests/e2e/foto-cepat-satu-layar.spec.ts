import { test, expect } from "@playwright/test";

/**
 * KAMERA = SATU LAYAR PENUH, TANPA GULIR (keluhan user 2026-08-06).
 *
 * *"user harus scroll dulu saat kamera aktif, saat menyimpan harus naik turun
 * itu viewportnya, tidak nyaman, fokuskan saja pada tampilan kamera dan jepret
 * dalam satu layar tanpa scroll."*
 *
 * Cacatnya SENYAP dan tidak bisa ditangkap uji unit mana pun: kameranya jalan,
 * fotonya tersimpan, semua tombol ADA — yang salah cuma DI MANA mereka berada
 * saat jempol sedang memegang HP di lapangan. Dulu kamera dirender inline di
 * tengah kartu, di bawah judul, keterangan, spanduk, dan panel antrean; tiap
 * jepretan menambah baris antrean DI ATASNYA, jadi rana bergeser turun sedikit
 * demi sedikit dan orang mengejar tombol yang berpindah.
 *
 * Tiga janji yang dikunci di sini:
 *   1. rana terlihat begitu kamera dibuka — TANPA menggulir;
 *   2. halaman di belakang tidak bisa ikut tergulir;
 *   3. posisi rana TIDAK bergeser setelah memotret.
 */
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test.describe("Foto Cepat — satu layar, tanpa gulir", () => {
  test.beforeEach(async ({ page, context }) => {
    test.skip(test.info().project.name !== "mobile", "keluhannya soal layar ponsel");
    await context.grantPermissions(["geolocation", "camera"]);
    await context.setGeolocation({ latitude: -6.87, longitude: 112.5 });
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
  });

  const bukaKamera = async (page: import("@playwright/test").Page) => {
    await page.getByRole("button", { name: /buka kamera/i }).click();
    const video = page.getByLabel("Pratinjau kamera");
    await expect(video).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
    const rana = page.getByRole("button", { name: "Jepret" });
    await expect(rana).toBeEnabled({ timeout: 20_000 });
    return rana;
  };

  test("rana langsung terlihat di layar — tanpa digulir sedikit pun", async ({ page }) => {
    const rana = await bukaKamera(page);
    const kotak = (await rana.boundingBox())!;
    const layar = page.viewportSize()!;

    // Halaman TIDAK boleh tergulir untuk memperlihatkan rana.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Seluruh tombol berada di dalam layar, bukan cuma tepinya.
    expect(kotak.y).toBeGreaterThanOrEqual(0);
    expect(kotak.y + kotak.height).toBeLessThanOrEqual(layar.height);
    // Dan tidak menempel persis di tepi bawah — area aman bilah gestur.
    expect(layar.height - (kotak.y + kotak.height)).toBeGreaterThan(4);
  });

  test("pratinjau memenuhi layar, bukan sepotong kartu di tengah halaman", async ({ page }) => {
    await bukaKamera(page);
    const layar = page.viewportSize()!;
    const lapisan = page.getByRole("dialog", { name: "Kamera" });
    const kotak = (await lapisan.boundingBox())!;
    expect(kotak.width).toBeGreaterThanOrEqual(layar.width - 1);
    expect(kotak.height).toBeGreaterThanOrEqual(layar.height - 1);
    expect(kotak.y).toBeLessThanOrEqual(0.5);
  });

  test("halaman di belakang terkunci — menyeret tidak menggeser apa pun", async ({ page }) => {
    // Tanpa kunci ini, seretan di atas pratinjau menggulir halaman di baliknya
    // dan gerakan "tarik untuk muat ulang" bisa memuat ulang halaman di tengah
    // pemotretan — foto yang belum sempat tersimpan ikut hilang.
    await bukaKamera(page);
    await page.evaluate(() => window.scrollBy(0, 800));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("posisi rana TIDAK bergeser setelah memotret", async ({ page, context }) => {
    // Inti keluhannya: antrean tumbuh tiap jepretan. Dulu antrean itu ada DI
    // ATAS kamera, jadi rana ikut melorot dan jempol harus mengejar.
    const rana = await bukaKamera(page);
    const sebelum = (await rana.boundingBox())!;

    /*
     * OFFLINE dulu, baru memotret — bukan gaya-gayaan.
     *
     * Ujinya menunggu "N foto menunggu kirim" sebagai bukti antrean benar-benar
     * tumbuh. Padahal keadaan itu memang DIRANCANG untuk lenyap: pengiriman yang
     * berhasil MENGHAPUS barisnya dari IndexedDB (`buang`, use-antrean.ts), dan
     * baris yang DITOLAK server tidak ikut dihitung `menunggu` sama sekali
     * (`ringkasAntrean`). Jadi jendelanya cuma selebar satu perjalanan jaringan.
     *
     * Di mesin sendiri jendela itu cukup lebar sehingga ujinya lulus; di runner
     * CI ia bisa tertutup sebelum pemeriksaan pertama, dan ujinya merah dengan
     * "element not found" yang tidak menyebut sebab apa pun. Gagal 3× hari ini,
     * termasuk retry, tanpa satu pun cacat produk di baliknya.
     *
     * Offline membuat pengiriman mustahil, jadi barisnya MENETAP di antrean —
     * keadaan yang ditunggu jadi pasti, bukan diperlombakan. Ini juga tidak
     * melemahkan yang diuji: yang dijanjikan adalah rana tidak bergeser saat
     * antrean tumbuh, dan justru offline-lah yang membuat antrean paling panjang
     * di lapangan.
     */
    await context.setOffline(true);
    await rana.click();
    await expect(page.getByText(/foto menunggu kirim/i)).toBeVisible({ timeout: 20_000 });
    await context.setOffline(false);

    const sesudah = (await rana.boundingBox())!;
    expect(sesudah.y).toBeCloseTo(sebelum.y, 0);
    expect(sesudah.x).toBeCloseTo(sebelum.x, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("menutup kamera mengembalikan gulir halaman", async ({ page }) => {
    // Kunci gulir yang lupa dilepas membuat SELURUH halaman macet setelahnya —
    // rusak parah, dan tidak terlihat dari layar kamera itu sendiri.
    await bukaKamera(page);
    await page.getByRole("button", { name: "Tutup kamera" }).click();
    await expect(page.getByRole("dialog", { name: "Kamera" })).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });
});
