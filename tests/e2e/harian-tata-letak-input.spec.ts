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
 * Sel kalender BERSTATUS menuju `?tgl=` (panel samping), BUKAN
 * `/harian/<tanggal>`. Sejak DECISIONS 355 hanya sel KOSONG yang melompat
 * langsung ke formulir; uji ini menyaring `hasText: "Draft"` sehingga selalu
 * mendarat di sel bersatus — tetap sah, tapi bedanya perlu disebut supaya
 * pembaca berikutnya tidak menyimpulkan seluruh sel berperilaku sama. Sebelumnya —
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

  test("layar input harian bebas galat hidrasi", async ({ page }) => {
    /*
     * Dipasang sesudah cacatnya nyata (DECISIONS 342): penanda baris sempat
     * mencetak `rowSeq` — penghitung tingkat MODUL yang di server terus naik
     * lintas permintaan dan di klien mulai dari 1 — sehingga atributnya berbeda
     * antara render server dan klien.
     *
     * Ketidakcocokan hidrasi tidak menjatuhkan halaman: React diam-diam
     * membuang render server dan merender ulang di klien. Yang hilang justru
     * yang tak terlihat — kecepatan tampil pertama di HP lapangan, dan jaminan
     * bahwa yang tercetak server memang yang dilihat orang.
     */
    const galat: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) galat.push(m.text().slice(0, 200));
    });
    await bukaDraft(page);
    await page.waitForTimeout(2_000);
    expect(galat, `galat hidrasi:\n${galat.join("\n")}`).toEqual([]);
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

  test("TIGA sumber foto langsung di tiap baris material & alat", async ({ page }) => {
    /*
     * Keluhan user 2026-08-17: *"mana pilihan foto cepat di alat dan bahan"* dan
     * *"seharusnya langsung saja 3 pilihan sumber foto seperti biasa"*. Yang
     * dijaga: ketiganya ADA di barisnya, tanpa tombol antara.
     */
    await bukaDraft(page);
    const pelengkap = page.locator("form", { hasText: "Pelengkap laporan KKP" }).first();
    await expect(pelengkap, "form pelengkap tidak muncul").toBeVisible();

    if (!(await fotoAktif(page))) {
      expect(await pelengkap.locator('input[type="file"]').count()).toBe(0);
      return;
    }
    const baris = pelengkap.locator("[data-baris]").first();
    for (const nama of ["Kamera", "Galeri", "Foto Cepat"]) {
      await expect(baris.getByText(nama, { exact: true }), nama).toBeVisible();
    }
    // Tidak boleh ada tombol antara lagi.
    await expect(page.getByText("Simpan & foto")).toHaveCount(0);
    await expect(page.getByText("Simpan dulu")).toHaveCount(0);
  });

  test("sumber foto di baris material RINGKAS — sepertiga ubin form pekerjaan", async ({ page }) => {
    /*
     * Keluhan user 2026-08-17: *"tombol sumber fotomu terlalu besar di bagian
     * alat dan bahan ini, perkecil sampai 1/3 nya."*
     *
     * Diukur, bukan dikira-kira. Ubin besar tetap BENAR di form item pekerjaan —
     * di sana ia pilihan utama layar dan terbit sekali per laporan. Di baris
     * material ia terbit sekali per BARIS, jadi tujuh salinan menenggelamkan
     * kolom yang justru harus diisi.
     *
     * Ambangnya 40%, bukan 33% pas: lebar tombol ringkas mengikuti panjang
     * katanya, jadi angkanya bergerak sedikit antar-font/zoom. Yang dijaga
     * perbedaan KELAS ukuran, bukan angka desimal.
     */
    await bukaDraft(page);
    test.skip(!(await fotoAktif(page)), "R2 nonaktif — sumber foto memang tidak dirender");

    const luas = async (akar: import("@playwright/test").Locator) =>
      akar.evaluate((el) =>
        ["Kamera", "Galeri", "Foto Cepat"]
          .map((teks) =>
            [...el.querySelectorAll("label,button")].find((n) =>
              n.textContent?.trim().startsWith(teks),
            ),
          )
          .reduce((jml, n) => {
            const r = n?.getBoundingClientRect();
            return jml + (r ? r.width * r.height : 0);
          }, 0),
      );

    const formItem = page.locator("form", { hasText: "Tambah / ubah progres pekerjaan" }).first();
    const barisMaterial = page.locator('[data-baris="material"]').first();
    const besar = await luas(formItem);
    const kecil = await luas(barisMaterial);

    expect(besar, "ubin form pekerjaan tidak terukur").toBeGreaterThan(0);
    expect(kecil, "sumber foto baris material tidak terukur").toBeGreaterThan(0);
    expect(
      kecil / besar,
      `sumber foto baris material ${Math.round(kecil)}px² vs ubin ${Math.round(besar)}px²`,
    ).toBeLessThan(0.4);
  });

  test("medan foto tiap baris TERPISAH — bukti tidak tertukar antarbaris", async ({ page }) => {
    /*
     * Semua baris hidup di SATU form. Tanpa awalan per baris, `photos` seluruh
     * baris menyatu jadi satu daftar dan tidak ada lagi cara mengetahui foto
     * mana milik baris mana — bukti menempel pada barang yang salah, diam-diam.
     */
    await bukaDraft(page);
    test.skip(!(await fotoAktif(page)), "R2 nonaktif — medan foto memang tidak dirender");
    const kunci = await page
      .locator("form", { hasText: "Pelengkap laporan KKP" })
      .first()
      .evaluate((f) => [...new FormData(f as HTMLFormElement).keys()].filter((k) => /photos$/.test(k)));
    expect(kunci.length, "tidak ada medan foto baris sama sekali").toBeGreaterThan(1);
    for (const k of kunci) expect(k, k).toMatch(/^[ma]\d+_photos$/);
    expect(new Set(kunci).size, "ada medan foto baris yang namanya kembar").toBe(kunci.length);
  });

  test("Enter di kolom Qty/Volume MENYIMPAN, bukan mengambil cuaca", async ({ page }) => {
    /*
     * Diukur di peramban sebelum diperbaiki: mengetik 41 lalu Enter memanggil
     * "Muat ulang cuaca" — karena tombol cuaca adalah tombol submit PERTAMA di
     * form, jadi dialah "default button"-nya — dan angka yang baru diketik
     * hilang saat badan form dipasang ulang. Di laporan yang cuacanya sudah
     * diisi manual, ketukan itu bahkan bisa MENIMPA pengamatan lapangan.
     */
    await bukaDraft(page);
    const pelengkap = page.locator("form", { hasText: "Pelengkap laporan KKP" }).first();
    await expect(pelengkap).toBeVisible();

    // Hanya BOLEH ada satu tombol submit di form ini, dan itu tombol simpan.
    const submits = await pelengkap.evaluate((f) =>
      [...f.querySelectorAll("button")]
        .filter((b) => ((b as HTMLButtonElement).type || "submit") === "submit")
        .map((b) => b.textContent?.trim() ?? ""),
    );
    expect(submits, "ada tombol submit lain yang akan membajak Enter").toEqual(["Simpan Pelengkap"]);

    const qty = pelengkap.locator('input[name="materialQty"]').first();
    await qty.scrollIntoViewIfNeeded();
    await qty.fill("7");
    await qty.press("Enter");

    await expect(page.getByText("Pelengkap laporan tersimpan.").first()).toBeVisible({
      timeout: 20_000,
    });
    // Angkanya BERTAHAN — bukti Enter benar-benar menyimpan, bukan memuat ulang.
    await expect(pelengkap.locator('input[name="materialQty"]').first()).toHaveValue("7");
  });

  test("form pelengkap tidak memuat form lain di dalamnya", async ({ page }) => {
    /*
     * Penerus penjaga DECISIONS 341. Dulu foto material diurus lewat form
     * tersendiri, dan `<form>` di dalam `<form>` dibuang peramban — tombolnya
     * diam saja saat ditekan. Sekarang fotonya ikut form pelengkap, jadi
     * invariannya lebih sederhana DAN berlaku di lingkungan mana pun (termasuk
     * CI tanpa R2): tidak boleh ada form bersarang di halaman ini.
     */
    await bukaDraft(page);
    const bersarang = await page.evaluate(() => document.querySelectorAll("form form").length);
    expect(bersarang, "ada <form> bersarang — tombol di dalamnya akan diam").toBe(0);
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
