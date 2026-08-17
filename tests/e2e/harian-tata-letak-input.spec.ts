import { test, expect, type Page } from "@playwright/test";

/**
 * TATA LETAK INPUT HARIAN (DECISIONS 341) — diuji di PERAMBAN, karena yang
 * diperbaiki memang hanya ada di peramban.
 *
 * Tiga hal yang tidak bisa dibuktikan uji unit maupun integrasi:
 *
 * 1. **Form foto material tidak bersarang.** Inilah alasan struktural kartu
 *    foto dulu terpisah jauh di bawah (DECISIONS 304): `<form>` di dalam
 *    `<form>` dibuang peramban, dan tombolnya jadi diam saja saat ditekan.
 *    Lembar foto sekarang di-portal ke `document.body`. Kalau suatu saat
 *    portalnya dilepas, halamannya TETAP terlihat benar — dan tombol simpannya
 *    diam-diam berhenti bekerja. Hanya pemeriksaan DOM yang menangkapnya.
 *
 * 2. **Pemicu foto ADA di baris material/alat.** Keluhan aslinya bukan "sulit
 *    dipakai" melainkan *"user tidak tahu kalau itu bisa diberi foto"* — jadi
 *    yang diuji keberadaannya di tempat yang benar, bukan cuma bisa diklik.
 *
 * 3. **Kirim dikunci sampai pertanyaan kendala dijawab.** "Tidak ada kendala"
 *    harus DIKATAKAN, bukan disimpulkan dari kolom yang dibiarkan kosong.
 */

const SLUG = process.env.E2E_SLUG ?? "kedungmutih";

async function masuk(page: Page) {
  await page.goto("/masuk");
  await page.fill('input[name="identifier"]', process.env.E2E_USER ?? "admin");
  await page.fill('input[name="password"]', process.env.E2E_PASS ?? "marlin123");
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

/**
 * Buka tanggal berstatus Draft, dicari lewat kalender lokasi.
 *
 * Sel kalender menuju `?tgl=` (panel samping), BUKAN `/harian/<tanggal>` —
 * versi pertama pencari ini mencocokkan pola path dan tidak menemukan apa pun,
 * sehingga SELURUH berkas ini melewat dengan status hijau. Uji yang melewat
 * karena pencarinya salah adalah uji yang berbohong; pencari di bawah karena
 * itu menyaring dari `?tgl=` dan penyaringnya sendiri diuji: kalau tidak ada
 * satu pun draft ditemukan, pemanggilnya menggagalkan berkas, bukan melewatinya.
 */
async function cariDraft(page: Page): Promise<string | null> {
  await page.goto(`/lokasi/${SLUG}/harian`, { waitUntil: "networkidle" });
  // DIBATASI ke petak tanggal. Versi sebelumnya memindai seluruh halaman dan
  // menangkap chip saringan "Draft (2)" — yang juga ber-"?tgl=" karena bilah
  // saringan mempertahankan tanggal terpilih — lalu membuka tanggal yang tidak
  // punya laporan sama sekali. Ujinya lalu MELEWAT, bukan gagal.
  const petak = page.getByRole("group", { name: "Petak tanggal" });
  const sel = petak.locator('a[href*="tgl="]').filter({ hasText: "Draft" });
  const n = await sel.count();
  for (let i = 0; i < n; i++) {
    const href = await sel.nth(i).getAttribute("href");
    const tgl = href?.match(/tgl=(\d{4}-\d{2}-\d{2})/)?.[1];
    if (tgl) return tgl;
  }
  return null;
}

/**
 * Apakah penyimpanan foto (R2) aktif di lingkungan ini?
 *
 * DI CI R2 TIDAK DIKONFIGURASI. Berkas ini semula menganggapnya selalu aktif —
 * karena dikembangkan di server lokal yang env R2-nya sengaja diisi — lalu
 * merah begitu masuk CI. Yang keliru bukan aplikasinya melainkan ujinya.
 *
 * Jalan keluarnya BUKAN `test.skip`. Uji yang melewat tidak membuktikan apa pun,
 * dan justru pada lingkungan tanpa R2 ada kontrak yang perlu dijaga: aplikasi
 * TIDAK menampilkan kontrol foto yang mati di setiap baris, karena alasannya
 * sudah disebut sekali di kepala bagian foto. Jadi kedua cabang sama-sama
 * diperiksa, masing-masing dengan pernyataannya sendiri.
 */
async function fotoAktif(page: Page): Promise<boolean> {
  const mati = page.getByText(/Penyimpanan foto .*belum diaktifkan/i);
  return (await mati.count()) === 0;
}

async function bukaDraft(page: Page): Promise<boolean> {
  const tgl = await cariDraft(page);
  // Data uji WAJIB punya draft; tanpa itu berkas ini tidak menguji apa pun dan
  // harus berteriak, bukan diam-diam hijau.
  expect(tgl, `tidak ada tanggal berstatus Draft di /lokasi/${SLUG}/harian`).not.toBeNull();
  await page.goto(`/lokasi/${SLUG}/harian/${tgl}`, { waitUntil: "networkidle" });
  return true;
}

test.describe("tata letak input harian", () => {
  test.beforeEach(async ({ page }) => {
    await masuk(page);
  });

  test("sumber foto pekerjaan tampil sebagai TIGA ubin setara", async ({ page }) => {
    await bukaDraft(page);
    // Dicari DI DALAM form input pekerjaan, bukan di halaman mana pun: ubin
    // dengan nama sama juga muncul di panel foto baris item, dan mencocokkan
    // sembarang yang pertama membuat uji ini hijau tanpa memeriksa yang dimaksud.
    const formItem = page.locator("form", { hasText: "Tambah / ubah progres pekerjaan" }).first();
    await expect(formItem).toBeVisible();

    if (!(await fotoAktif(page))) {
      // Tanpa R2, ubinnya memang tidak boleh ada — tapi SEBABNYA wajib tertulis,
      // bukan sekadar hilang tanpa keterangan.
      await expect(formItem.getByText(/Penyimpanan foto .*belum diaktifkan/i)).toBeVisible();
      await expect(formItem.getByText("Kamera", { exact: true })).toHaveCount(0);
      return;
    }
    for (const nama of ["Kamera", "Galeri", "Foto Cepat"]) {
      await expect(formItem.getByText(nama, { exact: true }).first(), nama).toBeVisible();
    }
  });

  test("pemicu foto ADA di tiap baris material & alat", async ({ page }) => {
    await bukaDraft(page);
    const pelengkap = page.locator("form", { hasText: "Pelengkap laporan KKP" }).first();
    await expect(pelengkap, "form pelengkap tidak muncul").toBeVisible();

    // Baris material yang SUDAH tersimpan membawa tombol "<n> foto"; baris baru
    // membawa "Simpan dulu" — dua-duanya penanda bahwa foto memang bisa di sini.
    const pemicu = pelengkap.locator('button[aria-label^="Foto untuk"]');
    if (!(await fotoAktif(page))) {
      // Kontrak lingkungan tanpa R2: JANGAN tawarkan kontrol yang mati di tiap
      // baris — alasannya sudah disebut sekali di bagian foto pekerjaan.
      expect(await pemicu.count(), "kontrol foto mati muncul padahal R2 nonaktif").toBe(0);
      return;
    }
    expect(await pemicu.count(), "tidak ada pemicu foto di baris material/alat").toBeGreaterThan(0);
  });

  test("baris BARU tetap menampilkan pemicunya, dengan alasan kenapa belum bisa", async ({ page }) => {
    // Keluhan aslinya soal PENGETAHUAN, bukan kenyamanan: *"user tidak tahu
    // kalau itu bisa diberi foto"*. Menyembunyikan kontrolnya pada baris yang
    // belum tersimpan mengajarkan hal yang sama salahnya — bahwa fiturnya tidak
    // ada. Yang benar: kontrolnya tetap terlihat, mati, dengan sebabnya.
    await bukaDraft(page);
    const pelengkap = page.locator("form", { hasText: "Pelengkap laporan KKP" }).first();
    test.skip(!(await fotoAktif(page)), "R2 nonaktif — pemicu foto memang tidak ada (dijaga uji di atas)");
    const sebelum = await pelengkap.locator('button[aria-label^="Foto untuk"]').count();
    await pelengkap.getByRole("button", { name: "Tambah material" }).click();

    const semua = pelengkap.locator('button[aria-label^="Foto untuk"]');
    expect(await semua.count(), "baris baru tidak membawa pemicu foto sama sekali").toBe(sebelum + 1);
    // Bukan `.last()`: baris material baru disisipkan SEBELUM bagian peralatan,
    // jadi yang terakhir di DOM adalah alat, bukan baris yang baru dibuat.
    // Baris kosong memberi dirinya label "material ini" — itu yang dicari.
    const baru = pelengkap.locator('button[aria-label="Foto untuk material ini"]').last();
    await expect(baru).toBeDisabled();
    await expect(baru).toHaveText(/Simpan dulu/);
    // Sebabnya tertulis, bukan cuma tombol kelabu tanpa keterangan.
    await expect(baru).toHaveAttribute("title", /Simpan pelengkap dulu/);
  });

  test("form lembar foto TIDAK bersarang di dalam form pelengkap", async ({ page }) => {
    await bukaDraft(page);
    test.skip(!(await fotoAktif(page)), "R2 nonaktif — lembar foto memang tidak bisa dibuka");
    const pemicu = page.locator('button[aria-label^="Foto untuk"]:not([disabled])').first();
    expect(await pemicu.count(), "tidak ada baris material/alat tersimpan di data uji").toBeGreaterThan(0);
    await pemicu.scrollIntoViewIfNeeded();
    await pemicu.click();

    const lembar = page.getByRole("dialog");
    await expect(lembar).toBeVisible();

    // INTI UJI INI: form di dalam lembar tidak boleh punya <form> leluhur.
    const bersarang = await lembar.locator("form").first().evaluate((el) => {
      const induk = el.parentElement?.closest("form");
      return induk !== null && induk !== undefined;
    });
    expect(bersarang, "form lembar foto bersarang di dalam form lain — tombolnya akan diam").toBe(false);

    // Dan tombol simpannya benar-benar terikat pada form itu.
    const punyaForm = await lembar
      .getByRole("button", { name: "Simpan foto" })
      .evaluate((el) => (el as HTMLButtonElement).form !== null);
    expect(punyaForm, "tombol Simpan foto tidak terikat form mana pun").toBe(true);
  });

  test("kirim terkunci sampai pertanyaan kendala dijawab", async ({ page }) => {
    await bukaDraft(page);
    const buka = page.getByRole("button", { name: /Review & Kirim/i });
    await expect(buka, "tombol kirim tidak muncul pada laporan draft").toBeVisible();
    await buka.click();

    const lembar = page.getByRole("dialog");
    await expect(lembar).toBeVisible();
    // Pertanyaannya HARUS terbaca — inilah seluruh gunanya memindahkannya ke sini.
    await expect(lembar.getByText("Ada kendala hari ini?")).toBeVisible();

    const kirim = lembar.getByRole("button", { name: /Pilih dulu|Kirim sekarang/ });
    await expect(kirim, "tombol kirim aktif sebelum kendala dijawab").toBeDisabled();

    await lembar.getByRole("button", { name: /Ada kendala/ }).click();
    // Memilih "ada" memunculkan kolomnya, dan kolom judulnya wajib.
    await expect(lembar.locator('input[name="kendalaTitle"]')).toBeVisible();
    await expect(kirim).toBeEnabled();

    await lembar.getByRole("button", { name: /Tidak ada/ }).click();
    await expect(lembar.locator('input[name="kendalaTitle"]')).toHaveCount(0);
    await expect(kirim).toBeEnabled();
  });
});
