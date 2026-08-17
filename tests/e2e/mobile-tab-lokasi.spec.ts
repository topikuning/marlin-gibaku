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
const SUB = ["", "/rab", "/rapl", "/harian", "/kegiatan", "/progress", "/keuangan", "/dokumen", "/laporan-lokasi"];

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
    expect(awal.ada, "deret tab tidak ditemukan — selector uji ini sudah basi").toBe(true);

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
