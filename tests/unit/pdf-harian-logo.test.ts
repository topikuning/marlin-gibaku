import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";

/**
 * LOGO KOP HARUS BENAR-BENAR TERTANAM DI PDF.
 *
 * Dua jebakan yang membuat logo hilang DIAM-DIAM (28 Juli 2026) — di layar
 * tampil, di semua keluaran PDF (unduh, Google Drive, WhatsApp) kosong:
 *
 *  1. Logo disimpan sebagai **WebP**; pdfkit hanya mendukung JPEG/PNG.
 *  2. pdfkit di sini adalah bundle **standalone** dengan shim `Buffer` sendiri,
 *     jadi Buffer Node dianggap bukan Buffer dan jatuh ke `fs.readFileSync`
 *     yang tidak ada di bundle itu. Karena itu logo dikirim sebagai data URI.
 *
 * Keduanya hanya terlihat kalau yang diperiksa adalah BYTE PDF-nya, bukan
 * "tidak melempar" — dulu errornya ditelan `catch` kosong.
 */

// Modul menarik rantai import yang memvalidasi env saat dimuat. Import statis
// akan di-hoist ke atas baris ini, jadi modulnya dimuat DINAMIS setelahnya.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { buildHarianKkpPdf } = await import("@/lib/pdf/harian-kkp");

const dasar: KkpDailyData = {
  locationName: "Lokasi Uji",
  regency: "Kabupaten",
  province: "Provinsi",
  hari: "Senin",
  tanggalFull: "1 Juli 2026",
  weekNo: 1,
  tahunAnggaran: 2026,
  workerMap: {},
  totalWorkers: 0,
  activeWeather: null,
  weatherByHour: null,
  workStart: null,
  workEnd: null,
  notes: null,
  materials: [],
  equipment: [],
  items: [],
  isFinal: true,
};

/** Berapa objek gambar yang benar-benar tertanam di PDF. */
function jumlahGambar(pdf: Buffer): number {
  return pdf.toString("latin1").split("/Subtype /Image").length - 1;
}

/** PNG kecil — hasil konversi yang SAMA dengan jalur produksi (WebP → PNG). */
async function logoPng(): Promise<Buffer> {
  const webp = await sharp({
    create: { width: 120, height: 120, channels: 4, background: { r: 10, g: 90, b: 170, alpha: 1 } },
  })
    .webp()
    .toBuffer();
  return sharp(webp).png().toBuffer();
}

describe("kop PDF laporan harian: logo pemilik", () => {
  it("logo yang diberikan BENAR-BENAR tertanam sebagai gambar di PDF", async () => {
    const pdf = await buildHarianKkpPdf(dasar, "MARLIN", await logoPng());
    // Penanda yang dipakai adalah `/Subtype /Image` — string "/Image" saja
    // juga muncul di keluaran pdfkit tanpa gambar apa pun, jadi tidak sahih.
    expect(jumlahGambar(pdf), "PDF harus memuat objek gambar").toBeGreaterThan(0);
  }, 30000);

  it("tanpa logo, PDF tetap terbentuk dan tidak memuat objek gambar", async () => {
    const pdf = await buildHarianKkpPdf(dasar, "MARLIN", null);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(jumlahGambar(pdf)).toBe(0);
  }, 30000);

  it("tidak ada kegagalan yang ditelan diam-diam saat menggambar logo", async () => {
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errs.push(a.map(String).join(" "));
    });
    await buildHarianKkpPdf(dasar, "MARLIN", await logoPng());
    spy.mockRestore();
    expect(errs, "console.error harus kosong – logo tergambar tanpa error").toEqual([]);
  }, 30000);
});
