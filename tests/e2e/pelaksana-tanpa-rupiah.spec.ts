import { test, expect, type Page } from "@playwright/test";
import { lewatiVerifikasiWa } from "./masuk";

/**
 * PELAKSANA TIDAK MELIHAT RUPIAH (DECISIONS 735).
 *
 * Ketetapan user 2026-11-01: *"untuk level pelaksana, jangan tampilkan nilai
 * rupiahnya sama sekali. hanya item, volume, satuan, presentase progress.
 * bahkan nilai kontrak lokasinya jangan dimunculkan."*
 *
 * Yang diperiksa adalah HTML LENGKAP halaman – termasuk data yang dikirim ke
 * peramban untuk komponen interaktif (payload RSC di dalam <script>) – bukan
 * hanya teks yang terlihat. Kolom yang disembunyikan tapi angkanya tetap
 * terkirim masih bocor; uji ini menangkapnya selama angkanya diformat "Rp".
 *
 * Prasyarat: `pnpm db:seed`. `mandor-01` (Pelaksana) ditugaskan ke
 * `kedungmutih` dan `purworejo`.
 */

const SLUG = "kedungmutih";

async function masuk(page: Page, username: string) {
  await page.goto("/masuk");
  await page.getByLabel("Username atau email").fill(username);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("marlin123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 15_000 });
  await lewatiVerifikasiWa(page);
}

/** "Rp" berdiri sendiri – label kolom "(Rp)" maupun angka "Rp 1.234". */
const RUPIAH = /\bRp\b/;
/**
 * Label uang yang angkanya kadang dicetak TANPA "Rp" (tabel perbandingan
 * revisi, formulir KKP). Kalau labelnya tidak ada, kolom angkanya juga tidak.
 */
const LABEL_UANG =
  /Harga satuan|Harga dasar|Harga analisa|Nilai kontrak|Nilai RAB|Nilai lama|Nilai baru|Nilai Fisik Lokasi|Nilai terpasang|NILAI PEKERJAAN|Nilai kekurangan|[Nn]ilai hari ini|pra-PPN|inkl\. PPN/;

/**
 * Kalimat penjelas yang MENYEBUT jenis angka tanpa menampilkannya – mis. banner
 * RAPL "Harga satuan, biaya pelaksanaan, dan potensi margin hanya bisa dilihat
 * oleh yang berwenang". Itu justru bukti angkanya ditahan, bukan kebocoran.
 */
const PENJELAS = /Harga satuan, biaya pelaksanaan, dan potensi margin/g;

function cariBocor(htmlMentah: string): string | null {
  const html = htmlMentah.replace(PENJELAS, "");
  for (const pola of [RUPIAH, LABEL_UANG]) {
    const m = html.match(new RegExp(`.{0,60}(?:${pola.source}).{0,40}`));
    if (m) return m[0].replace(/\s+/g, " ");
  }
  return null;
}

const HALAMAN = [
  `/lokasi/${SLUG}`,
  `/lokasi/${SLUG}/rab`,
  `/lokasi/${SLUG}/rab?bagian=rencana`,
  `/lokasi/${SLUG}/rab?bagian=revisi`,
  `/lokasi/${SLUG}/rab/backup-analisa`,
  `/lokasi/${SLUG}/rab/bandingkan`,
  `/lokasi/${SLUG}/rab/riwayat`,
  `/lokasi/${SLUG}/rapl`,
  `/lokasi/${SLUG}/rapl?bagian=kebutuhan`,
  `/lokasi/${SLUG}/rapl?bagian=validasi`,
  `/lokasi/${SLUG}/progress`,
  `/lokasi/${SLUG}/progress?bagian=kendala`,
  `/lokasi/${SLUG}/kawal`,
  `/lokasi/${SLUG}/laporan-lengkap`,
  `/lokasi/${SLUG}/harian`,
  `/lokasi`,
  `/progress`,
  `/peta`,
  `/cetak/jadwal/${SLUG}`,
  `/cetak/rencana/${SLUG}/1`,
  `/cetak/rencana-realisasi/${SLUG}`,
  `/cetak/periodik/${SLUG}/mingguan/1`,
];

test.describe("Pelaksana tidak melihat rupiah", () => {
  test.setTimeout(240_000);

  test("halaman lokasi, RAB, RAPL, progres, cetak: tidak ada \"Rp\" di HTML maupun datanya", async ({ page }) => {
    await masuk(page, "mandor-01");
    const bocor: string[] = [];
    for (const url of HALAMAN) {
      const res = await page.goto(url);
      // Halaman yang menolak (404) bukan kebocoran – tapi halaman inti harus tetap terbuka.
      if (!res || res.status() >= 400) continue;
      await page.waitForLoadState("networkidle").catch(() => {});
      const temuan = cariBocor(await page.content());
      if (temuan) bocor.push(`${url} → …${temuan}…`);
    }
    expect(bocor, bocor.join("\n")).toEqual([]);
  });

  test("halaman inti tetap terbuka – volume dan progres tetap ada", async ({ page }) => {
    await masuk(page, "mandor-01");
    for (const url of [`/lokasi/${SLUG}`, `/lokasi/${SLUG}/rab`, `/lokasi/${SLUG}/progress`]) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBeLessThan(400);
    }
    // Tabel RAB tetap ada: kolom Vol & Satuan, tanpa Harga satuan/Jumlah.
    await page.goto(`/lokasi/${SLUG}/rab`);
    await expect(page.getByRole("columnheader", { name: "Vol", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Satuan", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Jumlah", exact: true })).toHaveCount(0);
  });

  test("laporan harian (draft dan terkirim): tidak ada nilai rupiah per item", async ({ page }) => {
    await masuk(page, "mandor-01");
    await page.goto(`/lokasi/${SLUG}/harian`);
    // Buka laporan terbaru yang ada di kalender lokasi ini.
    const tautan = page.locator(`a[href^="/lokasi/${SLUG}/harian/20"]`);
    const hrefs = [...new Set(await tautan.evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))].slice(0, 3);
    expect(hrefs.length).toBeGreaterThan(0);
    const bocor: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("networkidle").catch(() => {});
      const temuan = cariBocor(await page.content());
      if (temuan) bocor.push(`${href} → …${temuan}…`);
    }
    expect(bocor, bocor.join("\n")).toEqual([]);
  });

  test("unduhan Excel RAB tidak memuat harga", async ({ page }) => {
    await masuk(page, "mandor-01");
    const res = await page.request.get(`/lokasi/${SLUG}/rab/export`);
    if (res.status() >= 400) return; // ditolak = tidak bocor
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.body()) as unknown as ArrayBuffer);
    const isi: string[] = [];
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((c) => {
          if (typeof c.value === "string") isi.push(c.value);
          if (c.numFmt && /Rp/.test(c.numFmt)) isi.push(`numFmt:${c.numFmt}`);
        }),
      ),
    );
    expect(isi.filter((s) => /harga|jumlah harga|\bRp\b|numFmt:|nilai/i.test(s))).toEqual([]);
  });

  test("API detail peta tidak mengirim nilai kontrak", async ({ page }) => {
    await masuk(page, "mandor-01");
    await page.goto("/peta");
    // Id lokasi ikut di data penanda halaman peta; yang bukan lokasinya ditolak API (403).
    const ids = [...new Set((await page.content()).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])];
    let diperiksa = 0;
    for (const id of ids.slice(0, 40)) {
      const res = await page.request.get(`/api/peta/${id}`);
      if (res.status() !== 200) continue;
      const json = (await res.json()) as { contractValue?: unknown };
      expect(json.contractValue ?? null, id).toBeNull();
      diperiksa++;
    }
    expect(diperiksa, "tidak ada lokasi yang bisa diperiksa lewat API peta").toBeGreaterThan(0);
  });
});

/*
 * PELAKSANA TIDAK MEMBUKA DOKUMEN (DECISIONS 736). Ketetapan user 2026-11-02:
 * *"poinnya pelaksana fokus pada pelaporan harian"*. Kontrak, adendum, dan
 * berkas pembayaran memuat nilai rupiah, dan isi berkas tidak bisa disaring.
 */
test.describe("Pelaksana tidak membuka dokumen", () => {
  test("menu, tab lokasi, dan alamat dokumen tertutup", async ({ page }) => {
    await masuk(page, "mandor-01");
    for (const url of ["/dokumen", `/lokasi/${SLUG}/dokumen`]) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(404);
    }
    await page.goto(`/lokasi/${SLUG}`);
    await expect(page.locator(`a[href="/lokasi/${SLUG}/dokumen"]`)).toHaveCount(0);
    await expect(page.locator('a[href="/dokumen"]')).toHaveCount(0);
  });
});
