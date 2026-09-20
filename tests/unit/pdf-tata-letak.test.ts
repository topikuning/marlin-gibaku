/*
 * DUA CACAT TATA LETAK PDF YANG TERLIHAT DI PRODUKSI 2026-09-19, dan penolong
 * yang menutupnya untuk SELURUH dokumen, bukan satu laporan saja.
 *
 * 1. JUDUL BAGIAN DITINGGAL SENDIRIAN. `sectionHeading` hanya memesan ruang
 *    untuk dirinya (34pt). Bagian yang isinya digambar bebas — grafik kurva-S —
 *    memanggil `ensureSpace` SESUDAH judulnya tercetak, jadi begitu isinya tak
 *    muat, halaman berganti dan judulnya tertinggal di atas sepertiga halaman
 *    kosong. Pembaca melihat judul tanpa isi dan menyimpulkan grafiknya gagal
 *    dibuat.
 *
 * 2. TEKS PANJANG TETAP PECAH DUA BARIS. `{ lineBreak: false, ellipsis: true }`
 *    milik pdfkit TIDAK menahannya: nama kategori "PEKERJAAN BANGUNAN SHELTER
 *    PENDARATAN IKAN" tetap membungkus dan baris keduanya menimpa kategori di
 *    bawahnya. Nama yang saling menimpa bukan soal rupa — pembaca jadi tidak
 *    tahu bar itu milik pekerjaan yang mana.
 */
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { createA4Doc, sectionHeadingKeepWith, truncateToWidth, PAGE_MARGIN, CONTENT_BOTTOM, PDF_FONT } =
  await import("@/lib/pdf/document");

const NAMA_PANJANG = "V PEKERJAAN BANGUNAN SHELTER PENDARATAN IKAN";

describe("truncateToWidth – satu baris, selalu", () => {
  it("teks yang muat dikembalikan apa adanya", () => {
    const doc = createA4Doc();
    doc.font(PDF_FONT.regular).fontSize(7.5);
    expect(truncateToWidth(doc, "I PEKERJAAN PERSIAPAN", 215)).toBe("I PEKERJAAN PERSIAPAN");
  });

  it("teks yang tidak muat dipotong dan MUAT – diukur, bukan ditebak", () => {
    const doc = createA4Doc();
    doc.font(PDF_FONT.regular).fontSize(7.5);
    const hasil = truncateToWidth(doc, NAMA_PANJANG, 90);
    expect(hasil.endsWith("…")).toBe(true);
    expect(doc.widthOfString(hasil)).toBeLessThanOrEqual(90);
    expect(hasil.length).toBeLessThan(NAMA_PANJANG.length);
  });

  it("lebar yang mustahil tidak melempar dan tidak mengembalikan string kosong", () => {
    const doc = createA4Doc();
    doc.font(PDF_FONT.regular).fontSize(7.5);
    const hasil = truncateToWidth(doc, NAMA_PANJANG, 1);
    expect(hasil.length).toBeGreaterThan(0);
  });
});

describe("sectionHeadingKeepWith – judul tidak pernah berpisah dari isinya", () => {
  it("isi tidak muat ⇒ judul ikut pindah halaman, bukan ditinggal", () => {
    const doc = createA4Doc();
    // Dorong kursor ke dekat kaki halaman: judul (34pt) masih muat, isi 200pt
    // TIDAK. Inilah keadaan yang dulu menghasilkan judul yatim.
    doc.y = CONTENT_BOTTOM - 60;
    const sebelum = doc.bufferedPageRange().count;
    sectionHeadingKeepWith(doc, "Kurva-S rencana vs realisasi", 200);
    expect(doc.bufferedPageRange().count).toBe(sebelum + 1);
    // Judulnya berada di ATAS halaman baru, jadi masih ada ruang untuk isinya.
    expect(doc.y).toBeLessThan(CONTENT_BOTTOM - 200);
    expect(doc.x).toBe(PAGE_MARGIN);
  });

  it("isi muat ⇒ tidak ada halaman baru yang dibuang", () => {
    const doc = createA4Doc();
    const sebelum = doc.bufferedPageRange().count;
    sectionHeadingKeepWith(doc, "Ringkasan progres", 120);
    expect(doc.bufferedPageRange().count).toBe(sebelum);
  });
});
