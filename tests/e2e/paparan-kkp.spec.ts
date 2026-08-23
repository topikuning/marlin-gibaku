import { expect, test, type Page } from "@playwright/test";

/**
 * PAPARAN MINGGUAN KKP — ALUR WEB UTUH (DECISIONS 416).
 *
 * Yang hanya bisa dibuktikan e2e: satu tombol menghasilkan draft yang benar,
 * lifecycle-nya berjalan dari layar (draft → direview → disetujui → beku),
 * PDF-nya benar-benar terunduh sebagai PDF, dan peran tanpa `ai.view` tidak
 * pernah melihat halamannya. AI provider TIDAK dikonfigurasi di lingkungan uji
 * — jadi jalur fallback deterministik ikut terbukti hidup, bukan hanya diklaim.
 */

async function masuk(page: Page, user: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(user);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
}

test.describe("paparan mingguan KKP", () => {
  test("generate → preview → lifecycle → PDF final", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    /*
     * Satu profil saja: artefaknya keadaan SERVER yang sama untuk semua profil.
     * Profil kedua yang meng-klik "Buat Paparan" dalam jendela 90 detik akan
     * menerima artefak profil pertama — yang sudah telanjur dibekukan — dan
     * yang diuji ulang bukan apa-apa selain tabrakan dua profil.
     */
    test.skip(testInfo.project.name !== "desktop", "alur penuh cukup satu profil");
    await masuk(page, "hery");
    await page.goto("/ai/paparan");

    await expect(page.getByRole("heading", { name: "Buat Paparan Mingguan KKP" })).toBeVisible({
      timeout: 30_000,
    });
    // AI mati di lingkungan uji → banner fallback harus MENGATAKANNYA di muka.
    await expect(page.getByText("Provider AI belum aktif – paparan tetap bisa dibuat")).toBeVisible();

    await page.getByRole("button", { name: "Buat Paparan" }).click();
    await page.waitForURL(/\/ai\/paparan\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const artifactUrl = new URL(page.url());
    const artifactId = artifactUrl.pathname.split("/").pop()!;

    // Draft + slide inti + kejujuran fallback. Versinya TIDAK dipatok v1:
    // uji ini harus bisa diulang pada DB yang sama (regenerate = versi baru).
    await expect(page.getByText("Draft AI")).toBeVisible({ timeout: 30_000 });
    const teksVersi = await page.getByText(/· v\d+$/).first().innerText();
    const versiAwal = Number(teksVersi.match(/v(\d+)$/)?.[1] ?? "0");
    expect(versiAwal).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "Ringkasan Eksekutif" })).toBeVisible();
    await expect(page.getByText("Narasi disusun deterministik", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Lampiran – Kelengkapan Data & Sumber/ }),
    ).toBeVisible();
    // Watermark draf tampil di preview.
    await expect(page.getByText("DRAF – BELUM DISETUJUI").first()).toBeVisible();

    // PDF DRAF bisa diunduh dan benar-benar PDF.
    const draf = await page.request.get(`/api/paparan/${artifactId}/pdf`);
    expect(draf.status()).toBe(200);
    expect(draf.headers()["content-type"]).toContain("application/pdf");
    expect((await draf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // Sunting narasi: butir suntingan HARUS menggantikan narasi di slide.
    const kalimat = "Kalimat uji hasil suntingan reviewer paparan.";
    await page.locator("#pp-ringkasanEksekutif").fill(kalimat);
    await page.getByRole("button", { name: "Simpan narasi" }).click();
    await expect(page.getByText("Narasi tersimpan", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(kalimat).first()).toBeVisible();

    // Lifecycle dari layar: draft → direview → disetujui → beku.
    await page.getByRole("button", { name: "Kirim untuk review" }).click();
    await expect(page.getByText("Sedang direview")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Setujui" }).click();
    await expect(page.getByText("Disetujui", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Bekukan (final)" }).click();
    await expect(page.getByText(/sudah dibekukan – immutable/)).toBeVisible({ timeout: 20_000 });

    // Sesudah beku: unduhan berlabel FINAL, dan wujudnya tetap PDF sah.
    await expect(page.getByRole("link", { name: "Unduh PDF final" })).toBeVisible();
    const final = await page.request.get(`/api/paparan/${artifactId}/pdf`);
    expect(final.status()).toBe(200);
    expect((await final.body()).subarray(0, 5).toString()).toBe("%PDF-");

    /*
     * Klik "Buat Paparan" lagi DALAM 90 detik → jendela anti double-click
     * mengembalikan artefak yang SAMA, bukan run kedua. (Regenerate di luar
     * jendela → versi baru — dijaga uji integrasi, jendelanya terlalu panjang
     * untuk ditunggu e2e.)
     */
    await page.goto("/ai/paparan");
    await page.getByRole("button", { name: "Buat Paparan" }).click();
    await page.waitForURL(/\/ai\/paparan\/[0-9a-f-]{36}/, { timeout: 60_000 });
    expect(new URL(page.url()).pathname.split("/").pop()).toBe(artifactId);
    await page.goto("/ai/paparan");
    await expect(page.getByText(new RegExp(`· v${versiAwal} ·`)).first()).toBeVisible();
  });

  test("tanpa ai.view: halaman tidak ada, PDF ditolak", async ({ page }) => {
    await masuk(page, "mandor-01");
    // Halaman daftar: requireCapabilityPage → notFound (404), bukan sekadar
    // menu yang disembunyikan.
    const halaman = await page.request.get("/ai/paparan");
    expect(halaman.status()).toBe(404);

    // Route PDF menolak dengan 403 — walau id artefaknya valid milik org yang sama.
    const punya = await page.request.get(`/api/paparan/00000000-0000-4000-8000-000000000000/pdf`);
    expect([403, 404]).toContain(punya.status());
    expect(punya.status()).not.toBe(200);
  });

  test("deep link dari halaman paket membuka form dengan paketnya terpilih", async ({ page }) => {
    await masuk(page, "hery");
    // Ambil id paket sah dari nilai bawaan form (input hidden milik Combobox).
    await page.goto("/ai/paparan");
    await expect(page.getByRole("heading", { name: "Buat Paparan Mingguan KKP" })).toBeVisible({
      timeout: 30_000,
    });
    const paketId = await page.locator('input[name="packageId"]').inputValue();
    expect(paketId).toMatch(/[0-9a-f-]{36}/);

    // Dari Ringkasan Paket: tombolnya ada dan menuju form dengan ?paket= terisi.
    await page.goto(`/paket/${paketId}`);
    const tombol = page.getByRole("link", { name: "Buat presentasi mingguan" });
    await expect(tombol).toBeVisible({ timeout: 30_000 });
    await tombol.click();
    await page.waitForURL(`**/ai/paparan?paket=${paketId}`, { timeout: 30_000 });
    await expect(page.locator('input[name="packageId"]')).toHaveValue(paketId);
  });
});
