import { test, expect, type Page } from "@playwright/test";

/**
 * PAGAR OVERFLOW MOBILE (DECISIONS 217).
 *
 * Teguran user 2026-08-02: "aku sudah bilang untuk cek tampilan mobile,
 * pastikan nyaman dan tidak over. kenapa selalu ada yg seperti ini terulang
 * lagi!" — dan memang benar: audit manual 390px pernah dikerjakan (tugas #11),
 * lalu regresi diam-diam karena tidak ada yang menjaganya.
 *
 * Yang diperiksa cuma satu invarian, tapi invarian yang tepat: **halaman tidak
 * boleh bisa digeser ke samping**. Di Safari iOS akibatnya bukan sekadar
 * "ada scroll" — seisi halaman diperkecil supaya muat, sehingga teksnya
 * mengecil dan tata letak antar blok jadi tidak seragam. Itu persis yang
 * dikeluhkan.
 *
 * Elemen lebar di DALAM kontainer ber-scroll sendiri (tabel RAB, blanko KKP)
 * TIDAK dihitung pelanggaran — itu pola yang memang disengaja (DECISIONS 010:
 * "scroll horizontal dalam kontainer, bukan melebarkan halaman").
 *
 * Kalau gagal, pesannya menyebut elemen mana yang melewati tepi kanan berikut
 * class-nya, supaya penyebabnya langsung ketahuan tanpa menebak.
 */

/** iPhone SE = layar paling sempit yang masih dipakai orang lapangan. */
const VIEWPORT = { width: 375, height: 812 };

const RUTE: { path: string; nama: string }[] = [
  { path: "/", nama: "Beranda / command center" },
  { path: "/aktivitas", nama: "Dashboard eksekutif" },
  { path: "/paket", nama: "Daftar paket" },
  { path: "/lokasi", nama: "Daftar lokasi" },
  { path: "/progress", nama: "Progress portofolio" },
  { path: "/hari-ini", nama: "Hari Ini (mandor)" },
  { path: "/laporan", nama: "Laporan" },
  { path: "/laporan/menunggu-verifikasi", nama: "Antrean verifikasi" },
  { path: "/laporan/perlu-koreksi", nama: "Antrean koreksi" },
  { path: "/keuangan", nama: "Keuangan" },
  { path: "/dokumen", nama: "Dokumen" },
  { path: "/peta", nama: "Peta" },
  { path: "/pengguna", nama: "Pengguna" },
];

type Pelanggar = { tag: string; cls: string; width: number; right: number; text: string };

async function ukur(page: Page): Promise<{ scrollWidth: number; clientWidth: number; pelanggar: Pelanggar[] }> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const batas = de.clientWidth;
    const pelanggar: Pelanggar[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= batas + 1) continue;
      // Di dalam kontainer ber-scroll/terpotong sendiri → bukan pelanggaran.
      let terkurung = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX;
        if (ov === "auto" || ov === "scroll" || ov === "hidden" || ov === "clip") {
          terkurung = true;
          break;
        }
      }
      if (terkurung) continue;
      const cls = typeof el.className === "string" ? el.className : String(el.getAttribute("class") ?? "");
      pelanggar.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 120),
        width: Math.round(r.width),
        right: Math.round(r.right),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      });
    }
    return { scrollWidth: de.scrollWidth, clientWidth: batas, pelanggar };
  });
}

test.describe("tampilan mobile: halaman tidak boleh melebar ke samping", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await page.goto("/masuk");
    await page.getByLabel("Username atau email").fill("hery");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
    await page.getByRole("button", { name: /masuk/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  });

  for (const { path, nama } of RUTE) {
    test(`${nama} (${path}) muat di ${VIEWPORT.width}px`, async ({ page }) => {
      // Viewport sudah dipaksa di atas, jadi menjalankan ulang di project
      // "desktop" hanya menggandakan waktu tanpa menambah cakupan.
      test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      // Halaman yang tidak boleh diakses role ini bukan urusan uji tata letak.
      test.skip(res != null && res.status() >= 400, `${path} tidak tersedia untuk role ini`);
      // Beri kesempatan peta/grafik selesai menggambar — keduanya sering baru
      // melebar SESUDAH mount, dan justru itu yang lolos dari periksa manual.
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1200);
      // Konten di bawah lipatan ikut diperiksa: sebagian baru dirender saat terlihat.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(600);

      const { scrollWidth, clientWidth, pelanggar } = await ukur(page);
      const rinci = pelanggar
        .slice(0, 10)
        .map((p) => `  <${p.tag}> lebar=${p.width} kanan=${p.right} class="${p.cls}" teks="${p.text}"`)
        .join("\n");
      expect(
        scrollWidth,
        `${path} bisa digeser ke samping (${scrollWidth}px > ${clientWidth}px). ` +
          `Di Safari iOS seisi halaman ikut diperkecil supaya muat.\n` +
          `Elemen yang melewati tepi kanan:\n${rinci || "  (tidak ada elemen tunggal — periksa margin/padding negatif)"}`,
      ).toBeLessThanOrEqual(clientWidth);
    });
  }

  /**
   * Halaman DALAM (workspace lokasi & paket) — di sinilah tabel RAB, editor
   * adendum, blanko harian, dan kurva-S berada, jadi justru paling rawan.
   * Slug/id diambil dari daftar supaya uji tidak terikat data seed tertentu.
   */
  test("halaman dalam lokasi & paket juga muat", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
    // Satu uji menelusuri belasan halaman — batas 30 detik bawaan jelas kurang.
    test.setTimeout(180_000);

    // Daftar lokasi/paket memakai AG Grid (baris bukan <a>), jadi slug diambil
    // dari seed yang deterministik; kalau datanya beda, uji dilewati alih-alih
    // gagal palsu.
    const SLUG = process.env.E2E_SLUG ?? "kedungmutih";
    const cek = await page.goto(`/lokasi/${SLUG}`, { waitUntil: "domcontentloaded" });
    test.skip(cek != null && cek.status() >= 400, `lokasi "${SLUG}" tidak ada di data uji`);
    // id paket diambil dari tautan di workspace lokasi (breadcrumb/ringkasan).
    const paketId = await page
      .locator('a[href^="/paket/"]')
      .first()
      .getAttribute("href", { timeout: 5_000 })
      .then((h) => h?.split("/")[2] ?? null)
      .catch(() => null);

    // Halaman ISI laporan harian — bukan cuma daftarnya. Di sinilah pita cuaca
    // per jam 07–21 berada, dan pita itu pernah MELEBARKAN seluruh halaman
    // (DECISIONS 230). Tanggalnya diambil dari tautan pertama di daftar supaya
    // uji tidak terikat tanggal tertentu.
    await page.goto(`/lokasi/${SLUG}/harian`, { waitUntil: "domcontentloaded" });
    // Harus berakhir dengan TANGGAL: tautan pertama di halaman itu
    // `/harian/import`, dan mengambilnya membuat uji ini menyapu halaman yang
    // salah sambil tetap hijau — persis cara sebuah sapuan berbohong.
    const harianHref = await page
      .locator(`a[href^="/lokasi/${SLUG}/harian/"]`)
      .evaluateAll((els) =>
        els
          .map((e) => e.getAttribute("href") ?? "")
          .find((h) => /\/\d{4}-\d{2}-\d{2}$/.test(h)) ?? null,
      )
      .catch(() => null);

    const dalam = [
      `/lokasi/${SLUG}`,
      `/lokasi/${SLUG}/rab`,
      `/lokasi/${SLUG}/rab/adendum`,
      `/lokasi/${SLUG}/rab/import`,
      `/lokasi/${SLUG}/progress`,
      `/lokasi/${SLUG}/harian`,
      ...(harianHref ? [harianHref] : []),
      `/lokasi/${SLUG}/keuangan`,
      `/lokasi/${SLUG}/dokumen`,
      ...(paketId && paketId !== "katalog" && paketId !== "baru" && paketId !== "bypass"
        ? [`/paket/${paketId}`, `/paket/${paketId}/kontrak`, `/paket/${paketId}/lokasi`]
        : []),
    ];

    const gagal: string[] = [];
    for (const path of dalam) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      if (res != null && res.status() >= 400) continue;
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const { scrollWidth, clientWidth, pelanggar } = await ukur(page);
      if (scrollWidth > clientWidth) {
        const rinci = pelanggar
          .slice(0, 5)
          .map((p) => `    <${p.tag}> lebar=${p.width} class="${p.cls}" teks="${p.text}"`)
          .join("\n");
        gagal.push(`${path} → ${scrollWidth}px > ${clientWidth}px\n${rinci}`);
      }
    }
    // Semua rute diperiksa dulu, baru dilaporkan sekaligus: memperbaiki satu
    // per satu sambil menunggu uji jalan ulang itu lambat dan menyesatkan
    // (perbaikan pertama sering memindahkan gejalanya, bukan menghabiskannya).
    expect(gagal, `Halaman dalam yang melebar:\n${gagal.join("\n")}`).toEqual([]);
  });
});
