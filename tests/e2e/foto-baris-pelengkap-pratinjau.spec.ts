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
 * Prasyarat: `pnpm db:seed` + penyimpanan foto terkonfigurasi (bagian foto di
 * form pelengkap hanya dirakit bila `isR2Configured()`).
 */

const SLUG = process.env.E2E_SLUG ?? "kedungmutih";

async function login(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

/**
 * Buka laporan harian yang MEMANG ADA, lewat daftarnya — bukan dengan merakit
 * tanggal sendiri.
 *
 * Versi pertama uji ini pergi ke tanggal "hari ini Asia/Jakarta". Itu bom
 * waktu: seed membuat laporannya pada tanggal mesin (UTC), dan sejak pukul
 * 17:00 UTC Jakarta sudah berganti hari — jadi uji yang sama hijau sepanjang
 * siang lalu merah sesudah tengah malam WIB, di layar yang benar-benar kosong
 * karena laporan tanggal itu belum ada. Terbukti di CI 2026-09-03 19:28 UTC.
 */
async function bukaLaporanDraft(page: Page): Promise<boolean> {
  await page.goto(`/lokasi/${SLUG}/harian?tampilan=daftar&saring=draft`);
  const baris = page.locator(".ag-row");
  await baris.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if ((await baris.count()) === 0) return false;
  await baris.first().locator("a").first().click();
  await page.waitForURL(/\/harian\/\d{4}-\d{2}-\d{2}$/, { timeout: 15_000 });
  return true;
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
    await login(page, "sm-01");
    if (!(await bukaLaporanDraft(page))) {
      test.skip(true, "seed tidak menyediakan laporan draft di lokasi ini");
      return;
    }

    await expect(page.locator('input[name="materialName"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Baris BARU: bentuknya sama dengan baris mana pun, tapi keberadaannya tidak
    // bergantung pada sisa data seed atau jalan uji sebelumnya.
    await page.getByRole("button", { name: "Tambah material" }).click();
    const baris = page.locator('[data-baris="material"]').last();

    // Pemilih kamera — yang benar-benar diketuk orang. Bukan input tersembunyi
    // ber-`name` (itu hasil rakitan state, memasukkan berkas ke sana tidak
    // memicu apa pun dan pratinjaunya tetap kosong).
    const kamera = baris.locator('input[type="file"][capture]');
    if ((await kamera.count()) === 0) {
      test.skip(true, "Penyimpanan foto (R2) tidak aktif di lingkungan ini.");
      return;
    }
    await kamera.setInputFiles({ name: "bukti.jpg", mimeType: "image/jpeg", buffer: JPEG_1PX });

    // Inilah yang dulu tidak ada: pernyataan bahwa fotonya memang terpilih.
    await expect(baris.getByText(/1 foto dipilih/i)).toBeVisible({ timeout: 10_000 });
    // Dan bisa dibatalkan – pilihan yang tidak bisa dicabut sama buruknya
    // dengan pilihan yang tidak terlihat.
    await expect(baris.getByRole("button", { name: "Buang foto 1" })).toBeVisible();
  });
});
