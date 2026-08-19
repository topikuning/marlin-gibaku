import { test, expect, type Page } from "@playwright/test";

/**
 * UMPAN BALIK NAVIGASI DI PONSEL (DECISIONS 245).
 *
 * Keluhan user 2026-08-04: *"di mobile, seringkali satu menu diklik, sistem
 * seperti stuck tidak merespon. ini secara ux membingungkan. aku tidak tau ini
 * kendala jaringan lambat atau memang ada masalah di mobile."*
 *
 * Pengukuran menjawab pertanyaannya: server MENJAWAB CEPAT (TTFB 17-54 ms pada
 * 84 lokasi). Yang memakan waktu memang jaringan — payload RSC 6-38 KB
 * terkompresi, 0,1-0,8 detik pada 400 kbps sebelum ditambah RTT seluler.
 * Cacatnya bukan pada lamanya, melainkan pada TIDAK ADANYA tanda apa pun
 * selama itu: App Router menahan transisi di halaman lama, jadi layar benar-
 * benar beku sampai payloadnya tiba. Obatnya karena itu bukan mempercepat
 * apa pun, melainkan MENGATAKAN bahwa ketukannya diterima.
 *
 * Uji ini MENIRU jaringan buruk itu (throttling CDP), lalu menuntut agar
 * SESUATU berubah di layar dalam ambang yang bisa dirasakan manusia. Tanpa
 * throttling, uji ini akan selalu lulus di mesin CI yang cepat dan tidak
 * menjaga apa pun — persis kondisi yang meloloskan cacat ini sejak awal.
 *
 * CATATAN: `loading.tsx` SENGAJA TIDAK dipakai, walau itu obat baku untuk
 * masalah ini. Dicoba dan ditarik lagi — batas Suspense membuat
 * `router.refresh()` sesudah server action tidak pernah selesai, sehingga
 * panel persetujuan adendum diam belasan detik seusai "Setujui aktivasi".
 * Itu cacat yang sama persis dengan yang sedang diperbaiki, hanya pindah ke
 * layar yang lebih berbahaya. Rinciannya di docs/OPEN_ISSUES.md.
 */

/** Pixel 7 lewat project "mobile"; di project desktop uji ini dilewati. */
const AMBANG_UMPAN_BALIK_MS = 1000;

/** 400 kbps / RTT 400 ms — sinyal lemah di kampung nelayan, bukan kasus ekstrem. */
const JARINGAN_LAMBAT = {
  offline: false,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
  latency: 400,
};

async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
}

/** Nyalakan throttling SESUDAH login supaya ongkosnya tidak terpakai di sana. */
async function lambatkan(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", JARINGAN_LAMBAT);
  return cdp;
}

test.describe("mobile: ketukan menu harus terlihat direspons", () => {
  test.beforeEach(async ({ page }) => {
    // Viewport ponsel datang dari project "mobile"; menjalankannya lagi di
    // project desktop hanya menggandakan waktu tanpa menambah cakupan.
    test.skip(test.info().project.name !== "mobile", "perilaku khusus ponsel");
    await login(page);
  });

  test("laci menu BERTAHAN sampai halaman benar-benar berganti", async ({ page }) => {
    /*
     * Ini inti keluhannya. Sebelum perbaikan, tiap tautan laci memanggil
     * setOpen(false) di onClick sehingga laci lenyap SEKETIKA — pengguna
     * kembali menatap halaman LAMA yang sama persis, lalu tidak terjadi
     * apa-apa selama payload menyeberang. Ketukan terbaca "menutup menu",
     * bukan "pindah halaman", dan wajar kalau lalu diketuk berulang kali.
     */
    await page.goto("/");
    await lambatkan(page);

    await page.getByRole("button", { name: "Menu" }).click();
    const laci = page.getByRole("dialog", { name: "Semua menu" });
    await expect(laci).toBeVisible();

    await laci.getByRole("link", { name: /Keuangan/ }).click();

    // Tepat sesudah ketukan, selagi halaman masih dimuat: laci WAJIB masih ada.
    await expect(laci, "laci menutup sebelum halaman berganti – layar jadi kosong tanpa tanda").toBeVisible();
    await expect(page).toHaveURL(/\/keuangan/, { timeout: 30_000 });
    // Dan ketika halamannya benar-benar tiba, laci menutup sendiri.
    await expect(laci).toBeHidden({ timeout: 10_000 });
  });

  test("ada perubahan di layar dalam 1 detik sesudah menu diketuk", async ({ page }) => {
    await page.goto("/");
    await lambatkan(page);

    await page.getByRole("button", { name: "Menu" }).click();
    const laci = page.getByRole("dialog", { name: "Semua menu" });
    await expect(laci).toBeVisible();

    const mulai = Date.now();
    await laci.getByRole("link", { name: /Progress/ }).click();

    // "Direspons" = salah satu tanda ini muncul. Sengaja tidak dipatok ke satu
    // mekanisme: yang dijanjikan ke pengguna adalah ADA umpan balik, bukan
    // bahwa umpan baliknya kebetulan datang dari bar/pemintal/kerangka.
    await Promise.race([
      page.locator('[role="progressbar"][aria-label="Memuat halaman"]').waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
      page.locator(".animate-spin").first().waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
      page.locator('[role="status"]').first().waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
    ]);

    const jeda = Date.now() - mulai;
    expect(jeda, `umpan balik baru muncul ${jeda}ms sesudah ketukan`).toBeLessThan(AMBANG_UMPAN_BALIK_MS);
    await expect(page).toHaveURL(/\/progress/, { timeout: 30_000 });
  });

  test("pintasan nav bawah juga memberi umpan balik", async ({ page }) => {
    // Pintasan tidak melewati laci, jadi jalurnya lain dan bisa regresi sendiri.
    await page.goto("/");
    await lambatkan(page);

    const nav = page.getByRole("navigation", { name: "Navigasi bawah" });
    const mulai = Date.now();
    await nav.getByRole("link", { name: /Lokasi|Proyek/ }).first().click();

    await Promise.race([
      page.locator('[role="progressbar"][aria-label="Memuat halaman"]').waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
      page.locator(".animate-spin").first().waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
      page.locator('[role="status"]').first().waitFor({ state: "visible", timeout: AMBANG_UMPAN_BALIK_MS }),
    ]);
    expect(Date.now() - mulai).toBeLessThan(AMBANG_UMPAN_BALIK_MS);
  });
});

test.describe("bar progres global", () => {
  test("muncul untuk navigasi yang BUKAN dari menu", async ({ page }) => {
    /*
     * Uji di atas memakai Promise.race, jadi bisa lulus hanya karena pemintal
     * di ikon menu. Yang dikunci di sini khusus bar globalnya — satu-satunya
     * umpan balik untuk perpindahan lewat tombol/tautan tabel/breadcrumb, yang
     * jumlahnya jauh lebih banyak daripada ketukan menu.
     */
    test.skip(test.info().project.name !== "mobile", "cukup sekali");
    await login(page);
    await page.goto("/lokasi");
    await lambatkan(page);

    // Tautan pertama menuju workspace sebuah lokasi — bukan item menu.
    await page.locator('a[href^="/lokasi/"]').first().click();
    await expect(
      page.locator('[role="progressbar"][aria-label="Memuat halaman"]'),
    ).toBeVisible({ timeout: AMBANG_UMPAN_BALIK_MS });
  });
});

/**
 * KETUKAN DI DAFTAR LOKASI — keluhan lapangan 2026-08-04:
 * *"user buka lokasi lalu klik lokasinya, seperti tidak terjadi apa pun, bisa
 * 2-3x klik. ini problem besar, karena akhirnya request berulang-ulang tapi
 * user merasa aplikasi tidak merespon."*
 *
 * Tiga cacat berbeda menumpuk di satu ketukan, dan semuanya terukur:
 *
 * 1. SASARAN KETUK. Satu-satunya yang bisa diketuk adalah tautan nama seluas
 *    75x16 px — 2,4% dari luas baris. Ketukan di mana pun selain di situ tidak
 *    memicu APA PUN, karena daftar lokasi tidak memasang aksi baris sama
 *    sekali. Jadi "seperti tidak terjadi apa pun" itu HARFIAH: memang tidak
 *    terjadi apa-apa.
 * 2. UMPAN BALIK. Ketika akhirnya kena, tidak ada tanda apa pun di benda yang
 *    baru disentuh.
 * 3. PERMINTAAN BERLIPAT. Diukur pada 400 kbps: tiga ketukan menghasilkan tiga
 *    permintaan halaman penuh + prefetch tab yang ikut berlipat = sembilan
 *    permintaan berebut pipa yang sama. Makin sering diketuk, makin lambat.
 */
test.describe("daftar lokasi: satu ketukan, satu permintaan", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "perilaku khusus ponsel");
    await login(page);
  });

  test("ketukan di baris (di luar teks tautan) membuka lokasinya", async ({ page }) => {
    await page.goto("/lokasi");
    const tautan = page.locator('a[href^="/lokasi/"]').first();
    await tautan.waitFor({ state: "visible", timeout: 30_000 });
    const lb = (await tautan.boundingBox())!;
    const baris = (await page.locator(".ag-row").first().boundingBox())!;
    const lebarLayar = page.viewportSize()!.width;

    // Titik ketuk WAJIB di dalam viewport. Baris grid jauh lebih lebar daripada
    // layar ponsel, jadi titik yang dihitung dari lebar baris bisa jatuh di
    // luar layar — ketukan ke ruang kosong lalu disalahartikan "tidak
    // menavigasi". Cacat itu sempat terjadi saat uji ini disusun.
    const x = Math.min(lebarLayar - 20, lb.x + lb.width + 40);
    expect(x, "titik ketuk harus terlihat di layar").toBeLessThan(lebarLayar);

    await page.mouse.click(x, baris.y + baris.height / 2);
    await expect(page).toHaveURL(/\/lokasi\/[^/]+$/, { timeout: 30_000 });
  });

  test("tiga ketukan beruntun tetap SATU permintaan halaman", async ({ page }) => {
    await page.goto("/lokasi");
    const tautan = page.locator('a[href^="/lokasi/"]').first();
    await tautan.waitFor({ state: "visible", timeout: 30_000 });
    await lambatkan(page);

    const permintaan: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url()).pathname;
      if (!/^\/lokasi\/[^/]+$/.test(u)) return;
      // PRA-AMBIL TIDAK DIHITUNG. Next mem-prefetch tiap tautan lokasi yang
      // terlihat di layar, jadi menghitung "semua permintaan ke /lokasi/*"
      // mencampur pra-ambil latar dengan navigasi sungguhan dan menghasilkan
      // angka yang tidak berarti apa-apa (sempat terbaca 11 untuk 3 ketukan).
      // Pra-ambil membawa header `Next-Router-Prefetch`.
      if (r.headers()["next-router-prefetch"]) return;
      permintaan.push(u);
    });

    await tautan.click();
    // Elemen yang diketuk WAJIB terlihat bereaksi — itu yang menghentikan
    // ketukan ulang, dan ketukan ulang itu yang menyesakkan jaringan.
    await expect(page.locator("a[data-navigating]")).toHaveCount(1, { timeout: 1000 });

    await page.waitForTimeout(200);
    await tautan.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    await tautan.click({ force: true }).catch(() => {});

    await expect(page).toHaveURL(/\/lokasi\/[^/]+$/, { timeout: 40_000 });
    expect(
      permintaan.length,
      `tiga ketukan menghasilkan ${permintaan.length} permintaan halaman: ${permintaan.join(", ")}`,
    ).toBe(1);
  });
});
