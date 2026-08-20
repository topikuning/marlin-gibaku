import { test, expect, type Page } from "@playwright/test";
import { LEBAR_SAPUAN, RUTE_DINAMIS, RUTE_STATIS, type KonteksRute } from "./rute-mobile";

/**
 * PAGAR OVERFLOW MOBILE (DECISIONS 217, diperluas 352).
 *
 * Teguran user 2026-08-02: *"aku sudah bilang untuk cek tampilan mobile … kenapa
 * selalu ada yg seperti ini terulang lagi!"* — lalu 2026-08-17, lagi:
 * *"lagi-lagi masalah tampilan mobile. kenapa harus terjadi lagi"*.
 *
 * Yang diperiksa cuma satu invarian, tapi invarian yang tepat: **halaman tidak
 * boleh bisa digeser ke samping**. Di Safari iOS akibatnya bukan sekadar "ada
 * scroll" — seisi halaman diperkecil supaya muat, sehingga teksnya mengecil dan
 * tata letak antar blok jadi tidak seragam.
 *
 * Elemen lebar di DALAM kontainer ber-scroll sendiri (tabel RAB, blanko KKP)
 * TIDAK dihitung pelanggaran — pola yang memang disengaja (DECISIONS 010).
 *
 * ### Tiga celah yang membuat keluhan kedua bisa terjadi
 *
 * Cacat 2026-08-17 lolos dari sapuan ini karena TIGA hal sekaligus, dan
 * memperbaiki satu saja tidak cukup:
 *
 *  1. **Rutenya tidak ada di daftar.** Daftarnya ditulis tangan di dalam berkas
 *     ini, jadi halaman baru lahir tidak terjaga. → daftar pindah ke
 *     `rute-mobile.ts`, dan `tests/unit/rute-terjaga.test.ts` menolak halaman
 *     yang tidak terdaftar.
 *  2. **Hanya satu lebar diuji.** Cacatnya TIDAK ADA di 375px: di sana deretan
 *     tombol membungkus sehingga setiap menu mulai dari tepi kiri. Baru di
 *     414px dua tombol muat sebaris, panel menu kedua mulai di x=264 dan
 *     mendorong halaman jadi 504px. → `LEBAR_SAPUAN`.
 *  3. **Hanya keadaan bawaan diuji.** Panel menunya baru ada di DOM setelah
 *     dibuka, dan blanko KKP baru dirender setelah "Tampilkan". Halaman yang
 *     dibuka apa adanya tampak sehat. → sapuan membuka setiap `<summary>` dan
 *     mengukur ulang; URL ber-query disediakan `rute-mobile.ts`.
 *
 * Kalau gagal, pesannya menyebut elemen mana yang melewati tepi kanan berikut
 * class-nya, supaya penyebabnya langsung ketahuan tanpa menebak.
 */

type Pelanggar = { tag: string; cls: string; width: number; right: number; text: string };
type Ukuran = { scrollWidth: number; clientWidth: number; pelanggar: Pelanggar[] };

async function ukur(page: Page): Promise<Ukuran> {
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

function rinci(u: Ukuran, n = 5): string {
  return (
    u.pelanggar
      .slice(0, n)
      .map((p) => `    <${p.tag}> lebar=${p.width} kanan=${p.right} class="${p.cls}" teks="${p.text}"`)
      .join("\n") || "    (tidak ada elemen tunggal – periksa margin/padding negatif)"
  );
}

/**
 * Periksa satu URL: keadaan bawaan, LALU dengan tiap menu `<summary>` dibuka.
 *
 * Menu dibuka satu per satu dan ditutup lagi — dua panel terbuka bersamaan
 * bukan keadaan yang bisa dicapai pengguna, dan menguji keadaan mustahil hanya
 * menghasilkan kegagalan yang tak seorang pun bisa tindak lanjuti.
 */
async function periksa(page: Page, path: string): Promise<string[]> {
  const gagal: string[] = [];
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  if (res != null && res.status() >= 400) return gagal;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);

  const bawaan = await ukur(page);
  if (bawaan.scrollWidth > bawaan.clientWidth) {
    gagal.push(`${path} → ${bawaan.scrollWidth}px > ${bawaan.clientWidth}px\n${rinci(bawaan)}`);
  }

  const menu = page.locator("summary");
  const n = Math.min(await menu.count(), 12);
  for (let i = 0; i < n; i++) {
    const s = menu.nth(i);
    const label = ((await s.textContent().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    try {
      await s.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await s.click({ timeout: 3_000 });
    } catch {
      continue; // menu yang tidak bisa diklik (tertutup elemen lain) bukan urusan uji lebar
    }
    await page.waitForTimeout(250);
    const buka = await ukur(page);
    if (buka.scrollWidth > buka.clientWidth) {
      gagal.push(
        `${path} – menu "${label}" DIBUKA → ${buka.scrollWidth}px > ${buka.clientWidth}px\n${rinci(buka)}`,
      );
    }
    await s.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  return gagal;
}

/** Nilai segmen dinamis diambil dari data yang benar-benar ada saat uji jalan. */
async function bacaKonteks(page: Page): Promise<KonteksRute> {
  const SLUG = process.env.E2E_SLUG ?? "kedungmutih";
  const cek = await page.goto(`/lokasi/${SLUG}`, { waitUntil: "domcontentloaded" });
  const slug = cek != null && cek.status() < 400 ? SLUG : null;

  const paketId = slug
    ? await page
        .locator('a[href^="/paket/"]')
        .first()
        .getAttribute("href", { timeout: 5_000 })
        .then((h) => {
          const id = h?.split("/")[2] ?? null;
          return id && !["katalog", "baru", "bypass", "vendor"].includes(id) ? id : null;
        })
        .catch(() => null)
    : null;

  let tanggal: string | null = null;
  if (slug) {
    await page.goto(`/lokasi/${slug}/harian`, { waitUntil: "domcontentloaded" });
    // Harus berakhir dengan TANGGAL: tautan pertama di halaman itu
    // `/harian/import`, dan mengambilnya membuat sapuan ini menyapu halaman
    // yang salah sambil tetap hijau — persis cara sebuah sapuan berbohong.
    tanggal = await page
      .locator(`a[href^="/lokasi/${slug}/harian/"]`)
      .evaluateAll(
        (els) =>
          els
            .map((e) => e.getAttribute("href") ?? "")
            .find((h) => /\/\d{4}-\d{2}-\d{2}$/.test(h))
            ?.split("/")
            .pop() ?? null,
      )
      .catch(() => null);
  }

  const idDari = async (path: string, awalan: string): Promise<string | null> => {
    const r = await page.goto(path, { waitUntil: "domcontentloaded" });
    if (r != null && r.status() >= 400) return null;
    return page
      .locator(`a[href^="${awalan}"]`)
      .first()
      .getAttribute("href", { timeout: 3_000 })
      .then((h) => h?.slice(awalan.length).split("/")[0] || null)
      .catch(() => null);
  };

  return {
    slug,
    paketId,
    tanggal,
    dokumenId: await idDari("/dokumen", "/dokumen/"),
    fotoId: await idDari("/foto", "/foto/"),
    aiRunId: await idDari("/ai/history", "/ai/run/"),
    antrean: null,
  };
}

for (const LEBAR of LEBAR_SAPUAN) {
  test.describe(`tampilan mobile ${LEBAR}px: halaman tidak boleh melebar ke samping`, () => {
    test.use({ viewport: { width: LEBAR, height: 812 } });

    test.beforeEach(async ({ page }) => {
      await page.goto("/masuk");
      await page.getByLabel("Username atau email").fill("hery");
      await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
      await page.getByRole("button", { name: /masuk/i }).click();
      await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
    });

    test(`seluruh halaman muat di ${LEBAR}px`, async ({ page }) => {
      // Viewport sudah dipaksa di atas, jadi menjalankan ulang di project
      // "desktop" hanya menggandakan waktu tanpa menambah cakupan.
      test.skip(test.info().project.name !== "mobile", "cukup sekali, di project mobile");
      test.setTimeout(900_000);

      const ktx = await bacaKonteks(page);
      const path: string[] = [...RUTE_STATIS.map((r) => r.pola)];
      const tanpaData: string[] = [];
      for (const r of RUTE_DINAMIS) {
        const urls = r.isi(ktx);
        if (urls) path.push(...urls);
        // Rute yang datanya tidak tersedia DISEBUT, bukan dilewati diam-diam:
        // "tidak diuji" yang terbaca seperti "lulus" adalah cara sapuan ini
        // pernah berbohong sebelumnya.
        else tanpaData.push(r.pola);
      }

      const gagal: string[] = [];
      for (const p of path) gagal.push(...(await periksa(page, p)));

      if (tanpaData.length) {
        console.log(`[overflow ${LEBAR}px] tidak diuji (data uji tidak menyediakan): ${tanpaData.join(", ")}`);
      }
      // Semua rute diperiksa dulu, baru dilaporkan sekaligus: memperbaiki satu
      // per satu sambil menunggu uji jalan ulang itu lambat dan menyesatkan
      // (perbaikan pertama sering memindahkan gejalanya, bukan menghabiskannya).
      expect(gagal, `Halaman yang melebar di ${LEBAR}px:\n${gagal.join("\n")}`).toEqual([]);
    });
  });
}
