import { test, expect, type Page } from "@playwright/test";

/**
 * TAB LOKASI HARUS TETAP TERJANGKAU (DECISIONS 354).
 *
 * Keluhan user 2026-08-17 di halaman RAB (903 item): *"scroll ke bawah, kembali
 * ke atas tab menu ringkasan, rab, progress, dll susah untuk discroll aktif di
 * layar, malah browser seperti mentok lalu refresh."*
 *
 * Dua cacat berbeda dalam satu kalimat, dan keduanya dijaga di sini:
 *
 *  1. **Tab ikut menggulir pergi.** Deret tab adalah satu-satunya jalan menuju
 *     sembilan halaman lain dari lokasi ini. Di halaman 903 item, berpindah tab
 *     berarti menggulir balik ke paling atas.
 *  2. **Tab aktif bisa berada di luar layar.** Deretnya lebih lebar dari layar
 *     ponsel; tanpa digulir sendiri, membuka tab ke-7 menampilkan deret yang
 *     berhenti di posisi paling kiri — tab yang sedang dibuka tidak terlihat.
 *
 * Diuji lewat GEOMETRI, bukan tangkapan layar: yang dijanjikan ke pengguna
 * adalah "tab ada di layar dan bisa ditekan", dan itu pertanyaan tentang
 * koordinat. Uji piksel akan merah setiap kali warnanya berubah.
 */

const LOKASI = process.env.E2E_SLUG ?? "kedungmutih";

/** Semua sub-halaman lokasi — tab aktifnya bergeser makin ke kanan. */
// "/keuangan" tidak ikut: tabnya DITAHAN untuk non-super_admin (DECISIONS 411)
// dan akun uji ini Program Director, jadi rutenya 404 – bukan tab yang bisa
// diperiksa geometrinya. Kembalikan bersama capability-nya.
const SUB = ["", "/rab", "/rapl", "/harian", "/kegiatan", "/progress", "/dokumen", "/laporan-lokasi"];

async function geometri(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Tab"]');
    const aktif = nav?.querySelector('[aria-current="page"]');
    const topbar = document.querySelector("header.sticky");
    const n = nav?.getBoundingClientRect();
    const a = aktif?.getBoundingClientRect();
    return {
      ada: !!nav,
      adaAktif: !!aktif,
      navTop: n ? Math.round(n.top) : null,
      navBottom: n ? Math.round(n.bottom) : null,
      topbarBottom: topbar ? Math.round(topbar.getBoundingClientRect().bottom) : null,
      aktifTeks: aktif?.textContent?.trim() ?? null,
      aktifKiri: a ? Math.round(a.left) : null,
      aktifKanan: a ? Math.round(a.right) : null,
      lebarLayar: document.documentElement.clientWidth,
      tinggiLayar: document.documentElement.clientHeight,
      overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    };
  });
}

test.describe("tab lokasi di ponsel", () => {
  test.use({ viewport: { width: 390, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  });

  test("tab tetap di layar setelah halaman digulir jauh ke bawah", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    const res = await page.goto(`/lokasi/${LOKASI}/rab`, { waitUntil: "domcontentloaded" });
    test.skip(res != null && res.status() >= 400, `lokasi "${LOKASI}" tidak ada di data uji`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1_000);

    const awal = await geometri(page);
    expect(awal.ada, "deret tab tidak ditemukan – selector uji ini sudah basi").toBe(true);

    // Halaman harus benar-benar bisa digulir; kalau tidak, uji ini tidak
    // membuktikan apa pun tentang "melekat".
    const tinggi = await page.evaluate(() => document.body.scrollHeight);
    expect(tinggi, "halaman uji terlalu pendek untuk membuktikan tab melekat").toBeGreaterThan(
      awal.tinggiLayar * 2,
    );

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const bawah = await geometri(page);
    // Masih di layar…
    expect(bawah.navTop).toBeGreaterThanOrEqual(0);
    expect(bawah.navBottom).toBeLessThanOrEqual(bawah.tinggiLayar);
    // …dan tepat menempel di bawah topbar: `top-0` akan menyembunyikannya DI
    // BALIK topbar yang juga melekat, dan gejalanya terlihat seperti tab hilang.
    expect(bawah.navTop).toBe(bawah.topbarBottom);
  });

  test("tab yang sedang aktif selalu terlihat, termasuk yang paling kanan", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    test.setTimeout(180_000);

    const gagal: string[] = [];
    for (const sub of SUB) {
      const res = await page.goto(`/lokasi/${LOKASI}${sub}`, { waitUntil: "domcontentloaded" });
      if (res != null && res.status() >= 400) continue;
      await page.waitForTimeout(800);
      const g = await geometri(page);
      if (!g.adaAktif) {
        gagal.push(`${sub || "/(ringkasan)"} → tidak ada tab bertanda aria-current`);
        continue;
      }
      if (g.aktifKiri! < 0 || g.aktifKanan! > g.lebarLayar) {
        gagal.push(
          `${sub || "/(ringkasan)"} → tab "${g.aktifTeks}" di luar layar (${g.aktifKiri}→${g.aktifKanan}, layar ${g.lebarLayar})`,
        );
      }
    }
    expect(gagal, `Tab aktif yang tidak terlihat:\n${gagal.join("\n")}`).toEqual([]);
  });

  test("tarik-untuk-muat-ulang peramban dimatikan", async ({ page }) => {
    /*
     * Gestur bawaan peramban: sekali halaman mentok di paling atas, sapuan ke
     * bawah berikutnya dibaca sebagai "muat ulang" — dan memuat ulang membuang
     * isian formulir yang belum tersimpan. Gestur menggulir dan gestur membuang
     * pekerjaan tidak boleh sama.
     */
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    await page.goto(`/lokasi/${LOKASI}/rab`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const g = await geometri(page);
    expect(g.overscroll).toBe("contain");
  });
});

/**
 * SEL KOSONG DI KALENDER MEMBUKA INPUTAN LANGSUNG (DECISIONS 355).
 *
 * Permintaan user 2026-08-17: *"laporan harian di halaman lokasi, klik kalender,
 * jika memang kosong langsung buka inputan laporan"*.
 *
 * Diuji lewat jalur yang sama dengan jari pengguna: KLIK selnya, lalu periksa
 * di mana ia mendarat dan apakah formulirnya benar-benar ada. Memeriksa `href`
 * saja akan hijau walau halaman tujuannya menolak membuka formulir.
 */
test.describe("kalender harian: sel kosong", () => {
  test.use({ viewport: { width: 390, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  });

  test("satu ketukan mendarat di formulir, bukan di panel samping", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    /*
     * Bulan DIPILIH, tidak dibiarkan bawaan. Bulan berjalan di data seed
     * kebetulan tidak punya satu pun hari kosong — seluruh harinya di luar
     * kontrak atau sudah berlaporan — sehingga uji ini akan "lulus" tanpa
     * menyentuh perilaku yang dijaganya. `?bulan=` membuat pilihan itu terlihat
     * di alamatnya, bukan bergantung pada tanggal berjalan.
     */
    const res = await page.goto(`/lokasi/${LOKASI}/harian?bulan=2026-06`, {
      waitUntil: "domcontentloaded",
    });
    test.skip(res != null && res.status() >= 400, `lokasi "${LOKASI}" tidak ada di data uji`);
    await page.waitForLoadState("networkidle").catch(() => {});

    const petak = page.getByRole("group", { name: "Petak tanggal" });
    // Sel KOSONG = yang membawa kata "Belum". Disaring dari dalam petak supaya
    // chip saringan di bilah atas tidak ikut tertangkap.
    const kosong = petak.locator("a").filter({ hasText: "Belum" }).first();
    const jumlah = await petak.locator("a").filter({ hasText: "Belum" }).count();
    // Kalau tidak ada satu pun, uji ini tidak membuktikan apa-apa — dan
    // "melewati" akan terbaca seperti "lulus".
    expect(jumlah, "tidak ada sel kosong di bulan ini – data uji tidak menguji apa pun").toBeGreaterThan(0);

    await kosong.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);

    // Mendarat di halaman TANGGAL, bukan kembali ke daftar dengan ?tgl=
    expect(page.url()).toMatch(new RegExp(`/lokasi/${LOKASI}/harian/\\d{4}-\\d{2}-\\d{2}$`));
    expect(page.url()).not.toContain("tgl=");

    // Dan formulirnya memang terbuka — bukan sekadar halaman yang benar.
    await expect(
      page.getByRole("button", { name: /simpan|tambah item/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("sel BERISI tetap membuka panel ringkasan, bukan langsung formulir", async ({ page }) => {
    /*
     * Batas keputusan itu. Panel samping meringkas item, foto, kendala, dan
     * kelengkapan — melompat ke formulir akan melewati ringkasan yang justru
     * jadi alasan orang membuka tanggal berisi.
     */
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    // Bulan yang memang punya sel berstatus di data seed.
    await page.goto(`/lokasi/${LOKASI}/harian?bulan=2026-08`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const petak = page.getByRole("group", { name: "Petak tanggal" });
    const berisi = petak.locator('a[href*="tgl="]').filter({ hasText: /item/ });
    const n = await berisi.count();
    test.skip(n === 0, "bulan ini tidak punya sel berstatus di data uji");

    await berisi.first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(600);
    expect(page.url()).toContain("tgl=");
    expect(page.url()).not.toMatch(/\/harian\/\d{4}-\d{2}-\d{2}$/);
  });
});
