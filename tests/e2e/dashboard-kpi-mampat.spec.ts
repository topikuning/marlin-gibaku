import { test, expect, type Page } from "@playwright/test";

/**
 * KARTU KPI DASHBOARD HARUS TETAP MAMPAT (keluhan user 2026-08-18 & 2026-08-19).
 *
 * *"kotak/card itu terlalu besar, kurang compact. itu di semua menu."* — lalu,
 * sesudah `KpiCard` dikecilkan (DECISIONS 361), keluhan yang sama datang lagi
 * untuk dashboard: *"mampatkan kpi card"*. Sebabnya: dashboard punya `StatCard`
 * sendiri yang tidak ikut dikecilkan.
 *
 * Ongkosnya bukan soal selera. Sepuluh kartu itu hal PERTAMA di layar, dan
 * dulu memakan 264px di desktop — 764px di HP. Peta, daftar "belum submit", dan
 * kendala, yang justru dicari orang, terdorong ke bawah lipatan setiap kali
 * halaman ini dibuka.
 *
 * Yang dikunci di sini BUKAN tinggi satu kartu (angka itu berubah tiap kali
 * font atau padding disetel), melainkan yang benar-benar dirasakan pengguna:
 * **berapa jauh isi sungguhan terdorong turun oleh blok KPI**. Diukur dari
 * puncak kartu pertama ke judul panel pertama di bawahnya, jadi ujinya tidak
 * bergantung pada struktur DOM kartu sama sekali.
 *
 * Anggaran di bawah dipilih dari pengukuran: tata letak lama menembusnya jauh
 * (≈287px desktop / ≈800px ponsel), tata letak sekarang lulus dengan sisa ±15%.
 * Kalau angka ini merah, seseorang menggemukkan kartunya lagi.
 */

const ANGGARAN = { desktop: 245, mobile: 640 } as const;

async function masukSebagaiManajemen(page: Page): Promise<void> {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("hery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: /masuk/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/masuk"), { timeout: 30_000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Total Lokasi", { exact: true })).toBeVisible({ timeout: 30_000 });
}

test.describe("Dashboard Eksekutif – blok KPI tetap mampat", () => {
  test.beforeEach(async ({ page }) => {
    await masukSebagaiManajemen(page);
  });

  test("blok KPI tidak mendorong isi halaman ke bawah lipatan", async ({ page }) => {
    /*
     * Halaman tanpa stylesheet tetap terbaca rapi sebagai teks polos — dan
     * ukurannya jadi tak berarti apa-apa. Kalau CSS tidak termuat, ujinya harus
     * berhenti, bukan lulus (DECISIONS 352).
     */
    expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);

    const kartuPertama = (await page.getByText("Total Lokasi", { exact: true }).boundingBox())!;
    const panelPertama = (await page
      .getByRole("heading", { name: "Peta Monitoring Lokasi" })
      .boundingBox())!;

    const terdorong = panelPertama.y - kartuPertama.y;
    const anggaran =
      test.info().project.name === "mobile" ? ANGGARAN.mobile : ANGGARAN.desktop;

    expect(
      terdorong,
      `Blok KPI mendorong isi ${Math.round(terdorong)}px ke bawah (anggaran ${anggaran}px).`,
    ).toBeLessThanOrEqual(anggaran);
  });

  test("memampatkan kartu tidak memotong label maupun angkanya", async ({ page }) => {
    /*
     * Memampatkan kartu gampang dicurangi: kecilkan saja sampai teksnya
     * terpotong. Jadi setiap label WAJIB muncul utuh, dan tidak boleh ada satu
     * pun kartu yang isinya meluber keluar kotaknya.
     */
    const label = [
      "Total Lokasi",
      "Sudah Submit Hari Ini",
      "Belum Submit Hari Ini",
      "Total Laporan Hari Ini",
      "Deviasi Negatif Kritis",
      "Nilai Kontrak",
      "Nilai Terpasang",
      "Paket Aktif",
      "Menunggu Verifikasi",
      "Perlu Koreksi",
    ];

    for (const l of label) {
      await expect(page.getByText(l, { exact: true })).toBeVisible();
    }

    const meluber = await page.evaluate((daftar: string[]) => {
      const buruk: string[] = [];
      for (const l of daftar) {
        const span = [...document.querySelectorAll("span")].find(
          (s) => s.textContent?.trim() === l && s.className.includes("uppercase"),
        );
        if (!span) {
          buruk.push(`${l}: labelnya tidak ditemukan sama sekali`);
          continue;
        }
        // Naik ke kotak kartunya, lalu bandingkan tinggi isi vs tinggi kotak.
        let kartu: HTMLElement | null = span.parentElement;
        while (kartu && getComputedStyle(kartu).borderTopWidth === "0px") {
          kartu = kartu.parentElement;
        }
        if (!kartu) {
          buruk.push(`${l}: kotak kartunya tidak ditemukan – uji ini jadi sia-sia`);
          continue;
        }
        if (kartu.scrollHeight > kartu.clientHeight + 1) {
          buruk.push(`${l}: isi ${kartu.scrollHeight}px di kotak ${kartu.clientHeight}px`);
        }
      }
      return buruk;
    }, label);

    expect(meluber, `Kartu yang isinya terpotong:\n${meluber.join("\n")}`).toEqual([]);
  });

  test("blok KPI tidak melebar keluar layar", async ({ page }) => {
    // Angka rupiah bisa panjang ("Rp 1.234,56 M"). Kartu yang dipersempit
    // sampai angkanya mendorong tata letak melebar menukar satu masalah dengan
    // masalah yang lebih buruk — DECISIONS 217.
    const luber = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth - de.clientWidth;
    });
    expect(luber).toBeLessThanOrEqual(0);
  });
});
