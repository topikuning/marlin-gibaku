import { test, expect, type Page } from "@playwright/test";

/**
 * Dialog konfirmasi HARUS benar-benar mengirim form-nya (DECISIONS 207).
 *
 * Bug yang ditemukan 2026-08-02: `ConfirmSubmit` menutup dialog di dalam
 * `onClick` tombol "Ya" yang bertipe submit. React mem-flush update state
 * sinkron begitu handler selesai — SEBELUM peramban menjalankan aksi bawaan
 * tombol — sehingga tombolnya sudah lepas dari DOM saat form seharusnya
 * dikirim. Akibatnya SEMUA dialog konfirmasi di aplikasi ini (setujui termin,
 * hapus dokumen, kirim pengingat) menutup diri tanpa melakukan apa pun:
 * penekanan "Ya" terlihat berhasil, padahal tidak ada yang terjadi.
 *
 * Ini tidak bisa dijaga uji unit/integrasi — kegagalannya ada di urutan antara
 * React dan peramban, jadi butuh peramban sungguhan.
 *
 * Prasyarat: DB dev ter-seed, server jalan di baseURL.
 */

async function loginAdmin(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill("admin");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

test.describe("dialog konfirmasi", () => {
  test('menekan "Ya" benar-benar mengirim form, bukan sekadar menutup dialog', async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/sistem");
    await page.getByText("Pekerjaan Harian", { exact: true }).first().click();

    const pemicu = page.getByRole("button", { name: /Kirim (ulang )?pengingat/ }).first();
    // Panel hanya memasang tombol saat ada yang perlu ditagih. Kalau seed hari
    // ini tidak menghasilkan penerima, uji ini tidak punya yang bisa dibuktikan
    // — dilewati dengan alasan, bukan dinyatakan lulus.
    if (!(await pemicu.isVisible().catch(() => false))) {
      test.skip(true, "Tidak ada penanggung jawab yang perlu ditagih pada data seed hari ini.");
    }

    const kirim = page.waitForRequest((r) => r.method() === "POST", { timeout: 10_000 });
    await pemicu.click();
    await page.getByRole("button", { name: /^Ya, kirim/ }).first().click();
    // Inti uji: Server Action-nya BENAR-BENAR dipanggil.
    await expect(kirim).resolves.toBeTruthy();

    // Dan hasilnya dilaporkan — dialog yang menutup tanpa jejak adalah bug ini.
    await expect(page.getByText(/pesan terkirim|GAGAL|Hasil pengiriman barusan/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
