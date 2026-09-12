// BLOK TAMBAH/KURANG YANG VOLUME & SATUANNYA DI KOLOM BERSAMA.
//
// Dilaporkan user 2026-09-12 dengan tiga berkas MC-0 dari satu paket yang sama:
// Pasar Banggi dan Karangmangu terbaca benar, TAMBAKAGUNG tidak — *"tambakagung
// malah baca group nilai kontrak lalu muncul error itu"*.
//
// Ketiganya berformat tambah/kurang KKP. Bedanya cuma tata letak:
//
//   Banggi      : MC 0        | TAMBAH | KURANG | CCO - 01
//   Karangmangu : MC - 0      | TAMBAH | KURANG | CCO - 01
//   Tambakagung : NILAI KONTRAK | TAMBAH | KURANG | MC - 0
//
// Nama blok tidak jadi soal — `deteksiCco` memang menyimpulkan peran blok dari
// posisinya, bukan namanya. Yang membedakan Tambakagung: blok dasarnya hanya
// memuat HARGA SATUAN · JUMLAH · BOBOT. Kolom VOL dan SAT-nya ada SEKALI saja
// di kiri tabel (kolom 5 dan 6), dipakai bersama oleh semua blok.
//
// Pembuktian `volume × harga ≈ jumlah` mencari ketiganya DI DALAM blok, jadi
// tidak pernah terbukti; pencari kolom SATUAN juga menyerah. `deteksiCco`
// mengembalikan null, berkas jatuh ke jalur HPS biasa, dan yang terbaca adalah
// kolom HPS di sebelah kiri — kategori kembar (VIII dan VIII#2), Σ item meleset
// 5,5% dari total yang ditulis berkas itu sendiri, lalu impornya tumbang.
//
// Salah baca yang paling berbahaya bukan yang gagal, melainkan yang berhasil
// dengan angka yang salah. Uji ini memakai berkas user apa adanya.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { slimRabWorkbook } = await import("@/lib/rab/xlsx-slim");
const { deteksiCco } = await import("@/lib/rab/cco-import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");

const TAMBAKAGUNG = "mc0-tambakagung-blok-nilai-kontrak.xlsx";
const berkas = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;

async function sheetRab(nama: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await slimRabWorkbook(readFileSync(berkas(nama)), "RAB")) as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe("CCO KKP: volume & satuan boleh berada di kolom bersama", () => {
  it("Tambakagung dikenali sebagai berkas tambah/kurang, bukan HPS biasa", async () => {
    const peta = deteksiCco(await sheetRab(TAMBAKAGUNG));
    expect(peta, "berkas tambah/kurang tidak dikenali – akan dibaca sebagai HPS biasa").not.toBeNull();
    // Blok dasar = NILAI KONTRAK (harga satuan), blok hasil = MC - 0.
    expect(peta!.col.price, "harga satuan bukan dari blok NILAI KONTRAK").toBe(12);
    expect(peta!.col.vol, "volume hasil bukan dari blok MC - 0").toBe(23);
    expect(peta!.col.amount).toBe(25);
    expect(peta!.col.unit, "satuan tidak terbaca dari kolom bersama").toBeGreaterThan(0);
  });

  it("angkanya diambil dari kolom JUMLAH berkas ini, bukan dari kolom HPS", async () => {
    const { parsed, priceColumn } = await parseHpsBuffer(readFileSync(berkas(TAMBAKAGUNG)));
    expect(priceColumn.label, "masih dibaca sebagai HPS biasa").toMatch(/CCO KKP/i);

    const flat = flattenParsedRab(parsed);
    const total = flat.filter((n) => n.kind === "kategori").reduce((s, n) => s + n.amount, 0n);
    /*
     * Pembandingnya adalah kolom JUMLAH berkas itu sendiri pada baris yang
     * MARLIN baca (baris terlihat): Rp 2.367.925.554. Bukan angka di sel
     * totalnya (Rp 2.289.265.441) — sel itu hasil SUM yang cakupannya berbeda,
     * dan berkas ini memang memuat 708 baris tersembunyi yang sengaja tidak
     * dihitung (peringatannya sudah disebut di pratinjau).
     *
     * Dibaca lewat jalur HPS biasa, angkanya Rp 2.414.221.066 – dari kolom HPS
     * di sebelah kiri, bukan dari blok MC-0 yang berlaku.
     */
    const kolomBerkas = 2_367_925_554n;
    const selisih = total > kolomBerkas ? total - kolomBerkas : kolomBerkas - total;
    expect(
      Number(selisih),
      `Σ item ${total} meleset dari kolom JUMLAH berkas (${kolomBerkas})`,
    ).toBeLessThanOrEqual(Number(kolomBerkas) * 0.01);
  });

  it("kategori kembar berkas ini TIDAK dihilangkan – memang begitu isinya", async () => {
    /*
     * Sempat kukira ini tanda salah baca. Bukan: berkasnya sendiri memang
     * memakai angka romawi yang berulang — VIII muncul sebagai "PLUMBING
     * DISTRIBUSI AIR BERSIH" (baris 960) dan lagi sebagai "JALAN LINGKUNGAN DAN
     * SALURAN" (baris 1280), IX dua kali dengan cara yang sama.
     *
     * Dicatat sebagai uji, bukan sekadar komentar, supaya tidak ada yang
     * "merapikan" penomoran ini di kemudian hari dan diam-diam menggabungkan
     * dua blok pekerjaan yang berbeda menjadi satu.
     */
    const { parsed } = await parseHpsBuffer(readFileSync(berkas(TAMBAKAGUNG)));
    const kategori = flattenParsedRab(parsed).filter((n) => n.kind === "kategori");
    expect(kategori.filter((n) => n.code.startsWith("VIII"))).toHaveLength(2);
    expect(kategori.filter((n) => n.code.startsWith("IX"))).toHaveLength(2);
    // Kunci identitasnya tetap unik – itu yang menjaga realisasi tidak nyasar.
    expect(new Set(kategori.map((n) => n.lineageKey)).size).toBe(kategori.length);
  });
});
