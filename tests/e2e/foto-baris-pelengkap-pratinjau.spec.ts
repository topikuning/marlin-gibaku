import { test, expect, type Page } from "@playwright/test";

/**
 * MEMILIH FOTO HARUS TERLIHAT — termasuk di baris material & peralatan.
 *
 * Keluhan user 2026-09-03: *"kenapa aku nambah foto malah gak ada respon sama
 * sekali, apa ini sedang masalah?"*
 *
 * Tidak sedang bermasalah: fotonya memang terpilih, layarnya saja yang diam.
 * Baris material/alat memakai bentuk ringkas (`compact`) demi ruang, dan
 * `compact` juga yang mematikan blok pratinjau — blok itu dibuat untuk jalur
 * AUTO-SUBMIT, tempat pratinjau memang mubazir. Baris material/alat tidak
 * auto-submit: fotonya menunggu barisnya disimpan. Jadi satu-satunya tempat
 * foto benar-benar MENUNGGU justru yang tidak memberi tanda apa pun.
 *
 * Diuji dari LAYAR, bukan dari prop: pratinjau yang dihidupkan di berkas
 * komponen tapi tertutup gaya atau syarat lain akan lolos pemeriksaan sumber
 * dan tetap tak terlihat oleh pemakainya (blind spot §5 CARA_KERJA_AGEN).
 *
 * Prasyarat: `pnpm db:seed`.
 */

async function login(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/** Satu JPEG kecil yang sah – cukup untuk menguji reaksi layar. */
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

test.describe("baris pelengkap: memilih foto memberi tanda", () => {
  test("foto yang dipilih di baris material langsung terlihat, bukan senyap", async ({ page }) => {
    await login(page, "admin");

    // Masuk ke editor laporan harian lewat daftar lokasi – jalur yang sama
    // dengan yang dipakai orang, bukan URL yang dirakit sendiri.
    await page.goto("/lokasi");
    await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".ag-row").first().click();
    await page.waitForURL(/\/lokasi\/[^/]+$/, { timeout: 15_000 });

    const keHarian = page.getByRole("link", { name: /Laporan harian|Hari ini/i }).first();
    if ((await keHarian.count()) === 0) test.skip(true, "lokasi seed ini tidak punya pintu laporan harian");
    await keHarian.click();
    await page.waitForURL(/\/harian\//, { timeout: 15_000 });

    // Bagian material/peralatan – bentuk ringkas yang dikeluhkan.
    const pemilih = page.locator('input[type="file"][name$="photos"]').first();
    if ((await pemilih.count()) === 0) test.skip(true, "form pelengkap tidak tersedia pada laporan ini");

    await pemilih.setInputFiles({ name: "bukti.jpg", mimeType: "image/jpeg", buffer: JPEG_1PX });

    // Inilah yang dulu tidak ada: pernyataan bahwa fotonya memang terpilih.
    await expect(page.getByText(/1 foto dipilih/i).first()).toBeVisible({ timeout: 10_000 });
    // Dan bisa dibatalkan – pilihan yang tidak bisa dicabut sama buruknya
    // dengan pilihan yang tidak terlihat.
    await expect(page.getByRole("button", { name: /Buang foto 1/i }).first()).toBeVisible();
  });
});
