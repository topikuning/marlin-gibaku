import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * APLIKASINYA SENDIRI HARUS BISA DIBUKA TANPA SINYAL (DECISIONS 398).
 *
 * DECISIONS 257 menyelamatkan foto yang SUDAH dijepret: ia bertahan melewati
 * muat ulang, tab tertutup, dan HP dimatikan. Yang tersisa – dan ditulis
 * terang-terangan sebagai batas waktu itu – adalah halamannya sendiri: tanpa
 * service worker, `/foto-cepat` tidak bisa DIBUKA dari nol saat benar-benar
 * offline. Mandor yang HP-nya baru menyala di luar jangkauan tidak bisa
 * memotret sama sekali, dan buktinya hilang bukan karena sistemnya gagal
 * melainkan karena halamannya tak pernah muncul.
 *
 * Berkas ini menjaga tiga janji, tidak lebih:
 *   1. `/foto-cepat` terbuka saat offline;
 *   2. halaman itu MENGAKU dirinya simpanan, bukan pura-pura segar;
 *   3. halaman lain yang offline berkata "tidak ada jaringan" dengan jujur,
 *      bukan layar galat peramban.
 *
 * Service worker hanya didaftarkan di production build (di dev ia mengecoh HMR),
 * jadi uji ini berjalan lewat `pnpm start` seperti seluruh suite e2e.
 */

async function masuk(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
}

/**
 * MODE PESAWAT yang sungguhan.
 *
 * `context.setOffline(true)` saja TIDAK cukup di sini: permintaan yang
 * dikeluarkan service worker sendiri tidak selalu ikut diputus, jadi halaman
 * bisa terlihat "luring" padahal service worker-nya masih menjemput dari
 * server. Uji versi awal berkas ini hijau-merah bergantian justru karena itu –
 * dan yang hijau tidak membuktikan apa pun. Menggugurkan seluruh rute menutup
 * jalannya untuk semua pihak; `setOffline` tetap dipasang supaya
 * `navigator.onLine` di halaman ikut berkata jujur.
 */
async function modePesawat(context: BrowserContext) {
  await context.route("**/*", (rute) => rute.abort("internetdisconnected"));
  await context.setOffline(true);
}

async function sinyalKembali(context: BrowserContext) {
  await context.unroute("**/*");
  await context.setOffline(false);
}

/** Tunggu sampai service worker benar-benar MENGENDALIKAN halaman ini. */
async function tungguDikendalikan(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 30_000,
  });
}

/** Tanya service worker: `/foto-cepat` tersimpan sejak kapan (null = belum). */
async function simpananFotoCepat(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sw = reg?.active;
    if (!sw) return null;
    return new Promise<string | null>((selesai) => {
      const kanal = new MessageChannel();
      const jam = setTimeout(() => selesai(null), 3000);
      kanal.port1.onmessage = (e: MessageEvent) => {
        clearTimeout(jam);
        const d = e.data as { disimpanPada?: string } | null;
        selesai(typeof d?.disimpanPada === "string" ? d.disimpanPada : null);
      };
      sw.postMessage(
        { jenis: "info-simpanan", url: `${location.origin}/foto-cepat` },
        [kanal.port2],
      );
    });
  });
}

test.describe("PWA – aplikasi terbuka tanpa jaringan", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "alur lapangan = ponsel");
    await masuk(page);
  });

  test("/foto-cepat terbuka saat OFFLINE dan mengaku dari simpanan", async ({ page, context }) => {
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await tungguDikendalikan(page);

    // Kunjungan PERTAMA yang lewat service worker-lah yang tersimpan: saat
    // muat pertama tadi, pemasangnya belum mengendalikan halaman.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible();

    await modePesawat(context);
    await page.reload({ waitUntil: "domcontentloaded" });

    // Inti janji: halamannya MUNCUL, bukan layar galat peramban.
    await expect(page.getByRole("heading", { name: "Foto Cepat" })).toBeVisible({
      timeout: 20_000,
    });

    // Dan ia tidak berpura-pura segar. Data lokasi/kantong di halaman ini
    // berasal dari kunjungan terakhir; menyembunyikan itu berarti membiarkan
    // orang mengira daftarnya mutakhir.
    await expect(page.getByText("Ditampilkan dari simpanan HP ini")).toBeVisible({
      timeout: 20_000,
    });

    await sinyalKembali(context);
  });

  test("MODE PESAWAT dari aplikasi tertutup: Foto Cepat siap walau belum pernah dibuka", async ({
    page,
    context,
  }) => {
    // `beforeEach` sudah masuk dan berhenti di beranda. Menu Foto Cepat tidak
    // pernah disentuh di uji ini – itu intinya: aplikasi dipasang di kantor,
    // lalu HP dibawa ke lokasi tanpa sinyal.
    await tungguDikendalikan(page);

    // Penyiapan berjalan sendiri sesudah service worker aktif.
    await expect
      .poll(() => simpananFotoCepat(page), { timeout: 30_000 })
      .not.toBeNull();

    // Aplikasi DITUTUP, HP masuk mode pesawat, lalu aplikasinya dibuka lagi.
    // Halaman baru = jendela yang benar-benar baru: tidak ada apa pun yang
    // tersisa di memori halaman sebelumnya.
    await page.close();
    const lagi = await context.newPage();
    await modePesawat(context);

    await lagi.goto("/", { waitUntil: "domcontentloaded" });
    await expect(lagi.getByRole("heading", { name: "Tidak ada jaringan" })).toBeVisible({
      timeout: 20_000,
    });
    // Halaman luring TAHU Foto Cepat siap – dan mengatakannya. Kalimat ini
    // hanya muncul kalau skrip halaman luring pun ikut tersimpan.
    await expect(lagi.getByText(/siap dipakai memotret tanpa sinyal/i)).toBeVisible({
      timeout: 20_000,
    });

    await lagi.getByRole("link", { name: /buka foto cepat/i }).click();
    await expect(lagi.getByRole("heading", { name: "Foto Cepat" })).toBeVisible({
      timeout: 20_000,
    });
    // Bukan sekadar halamannya muncul: kameranya harus bisa dibuka.
    await expect(lagi.getByRole("button", { name: /buka kamera/i })).toBeVisible();

    await sinyalKembali(context);
  });

  test("halaman lain saat OFFLINE menjawab jujur, bukan layar galat peramban", async ({
    page,
    context,
  }) => {
    await page.goto("/foto-cepat", { waitUntil: "domcontentloaded" });
    await tungguDikendalikan(page);

    await modePesawat(context);
    await page.goto("/progress", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Tidak ada jaringan" })).toBeVisible({
      timeout: 20_000,
    });
    // Kalimat yang paling penting di halaman itu: fotonya tidak hilang.
    await expect(page.getByText(/terkirim sendiri begitu sinyal kembali/i)).toBeVisible();

    await sinyalKembali(context);
  });
});
