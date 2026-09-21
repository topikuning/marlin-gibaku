/*
 * KOLOM YANG DI-HIDE TIDAK PERNAH DIPAKAI — sama seperti BARIS yang di-hide.
 *
 * **Teguran user 2026-09-21**, melampirkan tangkapan layar berkasnya:
 *
 *   *"import rab/adendum, kenapa kamu baca dari kolom yang di hide. TOLOL!"*
 *   *"ini kolomnya, kenapa hal yang jelas, aku bilang kalau di-hide jangan
 *   digunakan."*
 *
 * Benar, dan aturannya memang sudah ada — hanya belum berlaku untuk KOLOM.
 * Sheet tersembunyi sudah disaring (`namaSheetXlsx`), baris tersembunyi sudah
 * diabaikan DAN dilaporkan (permintaan user 2026-09-09). Kolom tidak, jadi
 * pratinjau berkas Kedungrejo berbunyi *"kolom harga PENAWARAN (kolom M/N)"* —
 * padahal di berkasnya kolom K–N DISEMBUNYIKAN: judul kolomnya melompat dari J
 * ke O. Blok yang terlihat cuma "Kontrak" (E–H) dan "MC-0" (O–P).
 *
 * Kenapa ini bukan sekadar soal rupa: blok yang disembunyikan penyusunnya
 * adalah blok yang SENGAJA tidak dipakai — sisa tawar-menawar, draft, atau
 * hitungan lama. Membacanya berarti NILAI KONTRAK diambil dari angka yang
 * justru dibuang orangnya, tanpa satu pun kalimat di layar yang menyebutkannya.
 */
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { detectColumns, parseHpsWorkbook } = await import("@/lib/rab/hps-parser");

/**
 * Berkas uji sebentuk kasus nyata: blok KONTRAK (E–H) terlihat, blok PENAWARAN
 * (K–N) DISEMBUNYIKAN, blok MC-0 (O–P) terlihat.
 */
function bukuUji(opts: { sembunyikanPenawaran: boolean }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");

  /*
   * Baris grup blok harga. "KONTRAK" dan "MC-0" TIDAK dikenali `BLOCK_RE`
   * (/HPS|PENAWAR|NEGO/) – memang begitu berkas nyatanya: yang punya nama blok
   * berharga justru blok yang disembunyikan. Dua label blok dibutuhkan agar
   * baris grup terdeteksi, persis seperti di berkas Kedungrejo.
   */
  ws.getCell(1, 5).value = "KONTRAK";
  ws.getCell(1, 11).value = "HPS";
  ws.getCell(1, 13).value = "PENAWARAN";
  ws.getCell(1, 15).value = "MC-0";
  // Baris header utama.
  ws.getCell(2, 1).value = "NO";
  ws.getCell(2, 2).value = "URAIAN";
  ws.getCell(2, 5).value = "VOL";
  ws.getCell(2, 6).value = "SAT";
  ws.getCell(2, 7).value = "HARGA SATUAN";
  ws.getCell(2, 8).value = "JUMLAH HARGA";
  ws.getCell(2, 11).value = "HARGA SATUAN";
  ws.getCell(2, 12).value = "JUMLAH HARGA";
  ws.getCell(2, 13).value = "HARGA SATUAN";
  ws.getCell(2, 14).value = "JUMLAH HARGA";
  ws.getCell(2, 15).value = "HARGA SATUAN";
  ws.getCell(2, 16).value = "HARGA TOTAL";

  // Satu kategori + satu item, dengan angka BERBEDA di tiap blok supaya
  // ketahuan blok mana yang benar-benar terbaca.
  ws.getCell(3, 1).value = "I";
  ws.getCell(3, 2).value = "PEKERJAAN PERSIAPAN";
  ws.getCell(4, 1).value = "1";
  ws.getCell(4, 2).value = "Buat bedeng pekerja";
  ws.getCell(4, 5).value = 50;
  ws.getCell(4, 6).value = "m2";
  ws.getCell(4, 7).value = 1_741_735; // kontrak (terlihat)
  ws.getCell(4, 8).value = 87_086_775;
  ws.getCell(4, 11).value = 888_888; // HPS (tersembunyi)
  ws.getCell(4, 12).value = 44_444_400;
  ws.getCell(4, 13).value = 999_999; // PENAWARAN (tersembunyi) – TIDAK boleh dipakai
  ws.getCell(4, 14).value = 49_999_950;
  ws.getCell(4, 15).value = 1_741_735; // MC-0 (terlihat)
  ws.getCell(4, 16).value = 87_086_775;

  if (opts.sembunyikanPenawaran) {
    for (const c of [11, 12, 13, 14]) ws.getColumn(c).hidden = true;
  }
  return wb;
}

describe("detectColumns – kolom tersembunyi tidak boleh jadi kolom harga", () => {
  it("tanpa disembunyikan, PENAWARAN memang menang (dasar pembandingnya)", () => {
    // Uji ini memastikan fixture-nya benar-benar menghasilkan keadaan yang
    // dikeluhkan. Tanpa ini, uji di bawah bisa hijau karena alasan yang salah.
    const { col, priceSource } = detectColumns(bukuUji({ sembunyikanPenawaran: false }).worksheets[0]);
    expect(priceSource).toBe("penawaran");
    expect(col.price).toBe(13); // kolom M, persis yang dikeluhkan user
  });

  it("begitu blok PENAWARAN disembunyikan, ia TIDAK dipakai lagi", () => {
    const { col, priceSource } = detectColumns(bukuUji({ sembunyikanPenawaran: true }).worksheets[0]);
    expect(priceSource).not.toBe("penawaran");
    expect([11, 12, 13, 14]).not.toContain(col.price);
    expect([11, 12, 13, 14]).not.toContain(col.amount);
  });

  it("yang dipakai jadi blok TERLIHAT, dengan angkanya yang benar", () => {
    const { col } = detectColumns(bukuUji({ sembunyikanPenawaran: true }).worksheets[0]);
    const ws = bukuUji({ sembunyikanPenawaran: true }).worksheets[0];
    expect(Number(ws.getCell(4, col.price).value)).toBe(1_741_735);
  });

  it("kolom VOL/SAT pun tidak diambil dari blok tersembunyi", () => {
    const { col } = detectColumns(bukuUji({ sembunyikanPenawaran: true }).worksheets[0]);
    expect(col.vol).toBe(5);
    expect(col.unit).toBe(6);
  });

  it("lebar 0 diperlakukan sama dengan hidden – penyembunyian lewat lebar", () => {
    // Sebagian berkas menyembunyikan kolom dengan menyeret lebarnya ke nol,
    // bukan lewat menu Hide. Bagi yang melihat layar keduanya sama saja, jadi
    // aturannya pun harus sama (cadangan defensif yang sama dipakai untuk
    // baris: `row.hidden === true || row.height === 0`).
    const wb = bukuUji({ sembunyikanPenawaran: false });
    for (const c of [11, 12, 13, 14]) wb.worksheets[0].getColumn(c).width = 0;
    const { priceSource } = detectColumns(wb.worksheets[0]);
    expect(priceSource).not.toBe("penawaran");
  });
});

describe("parseHpsWorkbook – penyembunyian kolom DIKATAKAN, tidak didiamkan", () => {
  it("memperingatkan bahwa ada blok harga tersembunyi yang dilewati", () => {
    const { warnings } = parseHpsWorkbook(bukuUji({ sembunyikanPenawaran: true }));
    const w = warnings.find((x) => /tersembunyi/i.test(x) && /kolom/i.test(x));
    expect(w, `tidak ada peringatan kolom tersembunyi. warnings: ${JSON.stringify(warnings)}`).toBeTruthy();
    expect(w).toMatch(/PENAWARAN/i);
  });

  it("tanpa kolom tersembunyi, tidak ada peringatan itu sama sekali", () => {
    const { warnings } = parseHpsWorkbook(bukuUji({ sembunyikanPenawaran: false }));
    expect(warnings.find((x) => /kolom.*tersembunyi/i.test(x))).toBeUndefined();
  });

  it("angka yang tersimpan berasal dari blok terlihat, bukan blok tersembunyi", () => {
    const { parsed } = parseHpsWorkbook(bukuUji({ sembunyikanPenawaran: true }));
    const teks = JSON.stringify(parsed);
    expect(teks).toContain("87086775");
    expect(teks).not.toContain("49999950");
  });
});
