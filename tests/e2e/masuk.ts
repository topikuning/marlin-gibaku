import type { Page } from "@playwright/test";

/**
 * Lewati layar verifikasi nomor WhatsApp kalau login mendarat di sana.
 *
 * Sejak DECISIONS 570 login TIDAK langsung mendarat di beranda: selama nomor
 * WA-nya belum terbukti, orangnya singgah dulu di `/verifikasi-wa`. Itu memang
 * yang diminta — dan itu pula yang mematahkan 17 uji E2E di `main` (run 855):
 * uji yang memeriksa "login → Dashboard" mendadak melihat layar verifikasi.
 *
 * Yang dikerjakan di sini persis yang dikerjakan orang sungguhan yang belum
 * sempat memverifikasi nomornya: menekan "Lewati dulu". Bukan menambal dengan
 * menandai akun seed sudah terverifikasi — itu akan menyembunyikan layarnya
 * dari uji SEKALIGUS dari dev, dan permintaannya justru layar itu muncul.
 */
export async function lewatiVerifikasiWa(page: Page): Promise<void> {
  if (!page.url().includes("/verifikasi-wa")) return;
  await page.getByRole("button", { name: "Lewati dulu" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/verifikasi-wa"), { timeout: 15_000 });
}
