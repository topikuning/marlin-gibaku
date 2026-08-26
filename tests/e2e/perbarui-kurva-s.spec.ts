import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

/**
 * PERBARUI KURVA-S — alurnya harus benar-benar bisa dijalani (DECISIONS 364).
 *
 * Teguran user 2026-08-18: *"pengguna juga bingung dimana mereka harus upload
 * template kurva-s"* dan *"sulit membedakan mana hanya untuk melihat dan mana
 * yang akan mengubah data resmi"*.
 *
 * Uji ini menempuh alurnya seperti orang sungguhan: unduh template dari tombol
 * yang ada di layar, unggah berkas ITU JUGA kembali, tekan periksa, lalu baca
 * hasilnya. Uji yang hanya memeriksa "tombolnya ada" tidak membuktikan alurnya
 * bisa diselesaikan.
 */

const LOKASI = process.env.E2E_SLUG_RAB ?? "kedungmutih";

async function login(page: Page, username = "admin") {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 });
}

test.describe("Perbarui Kurva-S", () => {
  test("jalan masuknya terlihat dari SETIAP bagian Progress", async ({ page }) => {
    // Pertanyaan aslinya adalah "di mana saya unggah template kurva-S?".
    // Jawabannya tidak boleh menuntut orang menebak isi tab mana.
    await login(page);
    for (const b of ["ringkasan", "baseline", "jadwal", "kendala"]) {
      await page.goto(`/lokasi/${LOKASI}/progress?bagian=${b}`);
      await expect(
        page.getByRole("link", { name: "Perbarui Kurva-S" }),
        `tidak ada jalan masuk di bagian ${b}`,
      ).toBeVisible();
    }
  });

  test("ditandai jelas sebagai yang MENGUBAH data resmi", async ({ page }) => {
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress?bagian=baseline`);
    const panel = page.getByRole("region", { name: /Perbarui Kurva-S dari Excel/ }).or(
      page.locator("section").filter({ hasText: "Perbarui Kurva-S dari Excel" }).first(),
    );
    await expect(panel.getByText("Mengubah data resmi").first()).toBeVisible();
    // Kelima langkahnya disebut, bukan cuma tombol unggah yang berdiri sendiri.
    for (const l of ["Unduh template", "Sunting di Excel", "Unggah kembali", "Periksa hasilnya", "Terapkan"]) {
      await expect(page.getByText(l, { exact: true }).first(), l).toBeVisible();
    }
  });

  test("alur penuh: unduh template → unggah balik → periksa", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress?bagian=baseline`);

    // 1. Unduh template lewat tombol yang benar-benar ada di layar.
    const unduh = page.waitForEvent("download");
    await page.getByRole("link", { name: /Unduh template Kurva-S/ }).click();
    const berkas = await unduh;
    /*
     * Disimpan dengan NAMA ASLINYA, bukan memakai `download.path()`.
     *
     * Playwright menyimpan unduhan ke berkas sementara tanpa ekstensi, sehingga
     * unggahannya ditolak "File harus Excel (.xlsx)" — penolakan yang BENAR,
     * tapi bukan yang sedang diuji. Orang sungguhan mendapat
     * `time-schedule-<lokasi>.xlsx`.
     */
    expect(berkas.suggestedFilename()).toMatch(/\.xlsx$/);
    // Path POLOS: judul uji ini mengandung panah "→", dan direktori keluaran
    // yang memuatnya membuat `setInputFiles` gagal diam-diam (berkas tidak masuk
    // sama sekali, tanpa galat).
    const jalur = `/tmp/kurva-s-${Date.now()}.xlsx`;
    await berkas.saveAs(jalur);

    /*
     * Tunggu penanda langkah MAJU dulu.
     *
     * Bukan basa-basi: `setInputFiles` yang dijalankan sebelum React memasang
     * handler-nya melepas event `change` ke ruang hampa — berkasnya masuk ke
     * DOM tapi komponennya tidak pernah tahu, dan tombol "Periksa" tinggal mati
     * selamanya. Penanda langkah 2 baru menyala setelah klik unduh diproses
     * React, jadi ia sekaligus bukti halamannya sudah hidup.
     */
    await expect(page.locator('li[aria-current="step"]')).toContainText("Sunting di Excel");

    // 3. Unggah berkas yang sama kembali.
    await page.locator('input[type="file"][name="file"]').setInputFiles(jalur);
    await expect(page.getByRole("button", { name: /Periksa hasilnya/ })).toBeEnabled();

    // 4. Periksa — dan ini TIDAK boleh mengubah apa pun.
    await page.getByRole("button", { name: /Periksa hasilnya/ }).click();
    await expect(page.getByText("Hasil pemeriksaan")).toBeVisible({ timeout: 30_000 });

    // Berkasnya dikenali utuh: jumlah minggu cocok dan kurvanya tuntas 100%.
    await expect(page.getByText(/minggu terbaca/)).toBeVisible();
    await expect(page.getByText("Kurva tuntas di 100%")).toBeVisible();

    /*
     * Pulang-pergi TANPA disunting hanya boleh menggeser angka sepersekian
     * poin — sisa pembulatan saat template ditulis ke Excel. Kalau pergeserannya
     * besar, artinya ekspor dan impor tidak membaca hal yang sama, dan orang
     * yang cuma ingin "mengunduh lalu mengunggah lagi" diam-diam mengubah
     * rencananya sendiri.
     */
    const baris = page.locator("table tbody tr");
    const n = await baris.count();
    for (let i = 0; i < n; i += 1) {
      const teks = (await baris.nth(i).innerText()).trim();
      const cocok = teks.match(/([+−-])\s*([\d,.]+)\s*pp/);
      if (!cocok) continue;
      const selisih = Number(cocok[2].replace(",", "."));
      expect(selisih, `pergeseran terlalu besar: ${teks}`).toBeLessThan(1);
    }
  });

  /*
   * LANGKAH 5 — yang dulu tidak pernah diuji, dan karena itu rusak diam-diam
   * (DECISIONS 442). Laporan user: menekan "Terapkan" menjawab *"File jadwal
   * (.xlsx) wajib dipilih"* padahal berkasnya jelas terpampang di layar.
   *
   * Sebabnya React 19 me-RESET form setelah `action` selesai, seperti form
   * bawaan peramban: input berkas KOSONG lagi begitu langkah 4 tuntas.
   *
   * Uji round-trip di atas tidak bisa menangkap ini — berkas yang tidak
   * disunting menghasilkan kurva identik, jadi tombol "Terapkan" memang tidak
   * ditawarkan. Di sini berkasnya SENGAJA diubah supaya langkah 5 benar-benar
   * dilalui.
   */
  test("terapkan: berkas ikut walau input sudah dikosongkan React", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    await page.goto(`/lokasi/${LOKASI}/progress?bagian=baseline`);

    const unduh = page.waitForEvent("download");
    await page.getByRole("link", { name: /Unduh template Kurva-S/ }).click();
    const berkas = await unduh;
    const jalur = `/tmp/kurva-s-sunting-${Date.now()}.xlsx`;
    await berkas.saveAs(jalur);
    await expect(page.locator('li[aria-current="step"]')).toContainText("Sunting di Excel");

    /*
     * Sunting seperlunya: geser bobot antar-minggu pada satu pekerjaan. Jumlah
     * barisnya tidak berubah, jadi kurvanya tetap tuntas 100% — yang bergeser
     * cuma bentuknya, dan itu sudah cukup membuat "Terapkan" ditawarkan.
     */
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(jalur);
    const ws = wb.worksheets[0];
    let tersunting = false;
    for (let r = 6; r <= ws.rowCount && !tersunting; r += 1) {
      const isi: { kolom: number; nilai: number }[] = [];
      for (let c = 5; c <= ws.columnCount; c += 1) {
        const v = ws.getRow(r).getCell(c).value;
        if (typeof v === "number" && v > 0) isi.push({ kolom: c, nilai: v });
        if (isi.length === 2) break;
      }
      if (isi.length === 2) {
        ws.getRow(r).getCell(isi[0].kolom).value = isi[1].nilai;
        ws.getRow(r).getCell(isi[1].kolom).value = isi[0].nilai;
        tersunting = true;
      }
    }
    expect(tersunting, "template tidak memuat bobot mingguan yang bisa disunting").toBe(true);
    await wb.xlsx.writeFile(jalur);

    await page.locator('input[type="file"][name="file"]').setInputFiles(jalur);
    await page.getByRole("button", { name: /Periksa hasilnya/ }).click();
    await expect(page.getByText("Hasil pemeriksaan")).toBeVisible({ timeout: 30_000 });

    // Inti cacatnya: input berkas SUDAH kosong di titik ini.
    await expect
      .poll(async () =>
        page
          .locator('input[type="file"][name="file"]')
          .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0),
      )
      .toBe(0);

    // …namun langkah 5 tetap harus berjalan, karena berkasnya dipegang state.
    const terapkan = page.getByRole("button", { name: /Terapkan sebagai baseline baru/ });
    await expect(terapkan).toBeVisible();
    await terapkan.click();
    await expect(page.getByText(/wajib dipilih/)).toHaveCount(0);
    await expect(page.getByText("Mulai pembaruan lain")).toBeVisible({ timeout: 60_000 });
  });

  test("tanpa wewenang baseline, alurnya tidak ditawarkan", async ({ page }) => {
    // Pelaksana boleh MELIHAT progress, tapi tidak boleh mengubah rencana resmi.
    await login(page, "mandor-01");
    const res = await page.goto(`/lokasi/${LOKASI}/progress?bagian=baseline`);
    if (res && res.status() >= 400) return; // ditolak di level halaman — juga sah
    await expect(page.getByRole("link", { name: "Perbarui Kurva-S" })).toHaveCount(0);
    await expect(page.getByText("Perbarui Kurva-S dari Excel")).toHaveCount(0);
  });
});
