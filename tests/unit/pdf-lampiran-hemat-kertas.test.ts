// LAMPIRAN FOTO TIDAK BOLEH MEMBUANG KERTAS (DECISIONS 397).
//
// Keluhan user 2026-08-21: *"ternyata, itu sangat membuang-buang kertas saat
// dicetak"* — satu hari dengan 8 item berfoto memakan 4 lembar A4 yang
// masing-masing terisi seperempat.
//
// Sebabnya `mulaiHalamanBaru()` dipanggil di dalam perulangan pasangan kartu,
// jadi satu lembar hanya pernah memuat SATU baris. Yang diminta user cuma tata
// letak dua kolom (DECISIONS 301) dan material/alat di halaman sendiri
// (DECISIONS 304); pemenggalan per pasang tidak pernah diminta.
//
// Yang dijaga di sini bukan angka halaman tertentu — melainkan bahwa jumlah
// halaman TUMBUH LEBIH LAMBAT daripada jumlah kartu. Menegaskan "8 foto = 2
// halaman" akan mengunci hasil pada tinggi foto yang kebetulan berlaku
// sekarang; yang benar-benar salah dulu adalah pertumbuhannya yang satu-lawan-
// satu.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFormA4Doc, docToBuffer } from "@/lib/pdf/document";
import {
  gambarDokumentasi,
  gambarDokumentasiPelengkap,
  type FotoDok,
  type FotoPelengkapDok,
} from "@/lib/pdf/harian-kkp-lampiran";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";

const d = { contractorFirm: "PT Uji", contractorAddress: "Jl. Uji No. 1" } as unknown as KkpDailyData;

async function gambarContoh(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: "#999999" } })
    .jpeg()
    .toBuffer();
}

/**
 * Berapa LEMBAR yang dihabiskan lampiran, dihitung dari byte PDF-nya.
 *
 * Dikurangi satu: `createFormA4Doc` sudah membuka satu halaman sebelum apa pun
 * digambar — di produksi halaman itu terpakai blanko harian, di uji ini ia
 * tetap kosong. Menghitungnya sebagai biaya lampiran membuat uji ini melaporkan
 * angka yang lebih besar daripada kenyataan (dan itu sempat terjadi: 4 kartu
 * terbaca 2 lembar padahal semuanya muat di satu).
 */
function lembarLampiran(pdf: Buffer): number {
  const total = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return total - 1;
}

/** N kartu berbeda pekerjaan, masing-masing SATU foto (kasus paling umum). */
async function fotoSatuPerItem(n: number): Promise<FotoDok[]> {
  const buf = await gambarContoh();
  return Array.from({ length: n }, (_, i) => ({
    buf,
    pekerjaan: `Item ${i + 1}`,
    kategori: "PEKERJAAN PERSIAPAN",
    bobot: 0.29,
    link: null,
  }));
}

/**
 * Halaman baru PERSIS seperti di `harian-kkp.ts`: `margins.bottom = 0` mematikan
 * paginasi otomatis pdfkit. Tanpa itu pdfkit menyisipkan halaman sendiri saat
 * menggambar dekat margin bawah — dan uji ini akan mengukur perilaku pdfkit,
 * bukan pemenggalan yang kita tulis.
 */
function halamanBaruSepertiProduksi(doc: ReturnType<typeof createFormA4Doc>) {
  return () => {
    doc.addPage();
    doc.page.margins.bottom = 0;
  };
}

async function halamanDokumentasi(n: number): Promise<number> {
  const doc = createFormA4Doc();
  doc.page.margins.bottom = 0;
  gambarDokumentasi(doc, d, await fotoSatuPerItem(n), halamanBaruSepertiProduksi(doc));
  return lembarLampiran(await docToBuffer(doc));
}

describe("dokumentasi pekerjaan mengalir, tidak satu baris per lembar", () => {
  it("REGRESI: 8 kartu satu-foto TIDAK memakan 4 lembar", async () => {
    /*
     * Angka nyata dari cetakan produksi yang dikeluhkan user. Dengan
     * pemenggalan lama hasilnya persis 4 (ceil(8/2)); sekarang harus lebih
     * sedikit karena beberapa baris berbagi lembar.
     */
    expect(await halamanDokumentasi(8)).toBeLessThan(4);
  });

  it("REGRESI: satu lembar memuat LEBIH DARI satu baris kartu", async () => {
    // 4 kartu = 2 baris. Kalau masih satu baris per lembar, hasilnya 2.
    expect(await halamanDokumentasi(4)).toBe(1);
  });

  it("halamannya tumbuh lebih lambat daripada kartunya", async () => {
    const [h4, h12] = [await halamanDokumentasi(4), await halamanDokumentasi(12)];
    // Kartu naik 3×; halaman tidak boleh ikut naik 3×.
    expect(h12).toBeLessThan(h4 * 3);
  });

  it("tanpa foto tidak menerbitkan halaman dokumentasi sama sekali", async () => {
    /*
     * Halaman berjudul "DOKUMENTASI PEKERJAAN" tanpa isi membuat pembaca
     * mengira fotonya hilang — dan itu lembar terbuang yang paling sia-sia.
     *
     * Catatan uji gigi, supaya pembaca berikutnya tidak menyimpulkan lebih dari
     * yang dibuktikan: membuang penjaga `if (kartu.length === 0) return` TIDAK
     * memerahkan uji ini, karena perulangan atas daftar kosong memang tidak
     * pernah memanggil `mulaiHalamanBaru`. Jadi yang menegakkan perilaku ini
     * bukan penjaga itu melainkan bentuk perulangannya; penjaga itu berjaga-jaga
     * untuk penulisan ulang yang menggambar kop lebih dulu. Ditulis apa adanya
     * daripada mengaku "uji gigi lolos".
     */
    const doc = createFormA4Doc();
    let dipanggil = 0;
    gambarDokumentasi(doc, d, [], () => {
      dipanggil += 1;
      doc.addPage();
    });
    expect(dipanggil).toBe(0);
  });
});

describe("dokumentasi material/alat", () => {
  async function bukti(n: number): Promise<FotoPelengkapDok[]> {
    const buf = await gambarContoh();
    return Array.from({ length: n }, (_, i) => ({
      buf,
      nama: `Material ${i + 1}`,
      keterangan: "10 zak",
      link: null,
    }));
  }

  it("REGRESI: tetap MULAI di halaman sendiri", async () => {
    /*
     * Permintaan user 2026-08-08: *"foto material dan alat juga perlu
     * disendirikan / start halaman tersendiri setelah data foto-foto
     * pekerjaan"*. Menghemat kertas TIDAK boleh mengorbankan pemisahan ini —
     * kalau material menempel di ekor halaman foto pekerjaan, dua jenis bukti
     * yang berbeda jadi terbaca sebagai satu.
     */
    const doc = createFormA4Doc();
    doc.page.margins.bottom = 0;
    let dipanggil = 0;
    gambarDokumentasiPelengkap(
      doc,
      d,
      await bukti(2),
      "Dokumentasi Material Masuk",
      "Material",
      () => {
        dipanggil += 1;
        halamanBaruSepertiProduksi(doc)();
      },
    );
    expect(dipanggil).toBe(1);
  });

  it("barisnya ikut mengalir di halaman yang sama", async () => {
    const doc = createFormA4Doc();
    doc.page.margins.bottom = 0;
    gambarDokumentasiPelengkap(
      doc,
      d,
      await bukti(4),
      "Dokumentasi Material Masuk",
      "Material",
      halamanBaruSepertiProduksi(doc),
    );
    expect(lembarLampiran(await docToBuffer(doc))).toBe(1);
  });
});
