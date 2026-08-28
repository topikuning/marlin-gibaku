// BLANKO HARIAN TIDAK BOLEH MELUBER KELUAR KERTAS SAAT ITEMNYA BANYAK.
//
// Keluhan user 2026-08-27 dengan berkasnya: *"pdf yang diunggah ke drive
// berantakan saat itemnya banyak"*. Berkas `Laporan Harian - Suradadi -
// 2026-08-26.pdf` memperlihatkan tiga gejala yang semuanya berpangkal pada satu
// sebab:
//
//   * halaman 2 — daftar REALISASI PEKERJAAN tergambar terus sampai melewati
//     tepi bawah kertas; barisnya hilang dari cetakan;
//   * halaman 3 — nyaris kosong, hanya berisi penggalan "· dari 1.754 m³ ·
//     51,3%)", yaitu EKOR satu baris yang membungkus tepat di tepi bawah lalu
//     dilempar pdfkit ke halaman yang ia buka sendiri;
//   * halaman 7 & 8 — dua lembar kosong berisi separuh kaki halaman masing-
//     masing, dan penomoran yang menulis "dari 6" pada berkas berisi 8 lembar.
//
// Sebabnya: blok rencana/realisasi memesan ruang untuk SELURUH barisnya
// sekaligus (`fit(14 * (barisRR + 1))`) lalu menggambar tanpa penjagaan lagi.
// Begitu isinya lebih panjang dari satu halaman, tidak ada apa pun yang
// menghentikannya.
//
// Yang diuji di sini adalah KOORDINAT yang benar-benar dipakai menggambar, bukan
// jumlah halaman: jumlah halaman berubah wajar mengikuti isi, sedangkan
// menggambar di luar kertas selalu salah.
import { describe, expect, it } from "vitest";
import type { KkpDailyData, KkpDailyItem } from "@/components/knmp/kkp-daily-report";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { createFormA4Doc, FORM_MARGIN } = await import("@/lib/pdf/document");
const { tulisBadanHarian, kakiHalaman } = await import("@/lib/pdf/harian-kkp");

function item(i: number): KkpDailyItem {
  return {
    code: `1.${i}`,
    name: `Pekerjaan Uraian Panjang Nomor ${i} yang sengaja dibuat memanjang supaya membungkus`,
    unit: "m³",
    categoryCode: "V",
    categoryName: i % 7 === 0 ? `BANGUNAN KE-${i}` : "PEKERJAAN BANGUNAN SHELTER",
    volumeContract: 1754,
    volumeBefore: 800,
    volumeToday: 100,
    volumeCumulative: 900,
    pctCumulative: 51.3,
  };
}

function data(banyakItem: number, banyakMaterial = 0): KkpDailyData {
  return {
    locationName: "Suradadi",
    regency: "Kabupaten Tegal",
    province: "Jawa Tengah",
    hari: "Rabu",
    tanggalFull: "26 Agustus 2026",
    weekNo: 5,
    tahunAnggaran: 2026,
    workerMap: {},
    totalWorkers: 16,
    activeWeather: null,
    weatherByHour: null,
    workStart: "08:00",
    workEnd: "17:00",
    notes: null,
    materials: Array.from({ length: banyakMaterial }, (_, i) => ({
      name: `Material ${i + 1}`,
      unit: "zak",
      qty: i + 1,
    })),
    equipment: [],
    items: Array.from({ length: banyakItem }, (_, i) => item(i + 1)),
    isFinal: true,
  } as unknown as KkpDailyData;
}

/**
 * Gambar badan laporan sambil MENCATAT tiap koordinat y yang dipakai
 * `doc.text()`, lalu kembalikan yang paling bawah.
 *
 * Kenapa `doc.text` dan bukan hasil PDF-nya: itulah satu-satunya tempat yang
 * tahu di mana isi blanko benar-benar diletakkan. Byte PDF-nya sudah terlambat —
 * teks di luar kertas tetap tersimpan, hanya tidak terlihat, dan itu persis
 * kegagalan yang sedang diuji.
 */
function gambarDanUkur(d: KkpDailyData): {
  terbawah: number;
  tinggiHalaman: number;
  tertulis: string[];
} {
  const doc = createFormA4Doc();
  let terbawah = 0;
  const tertulis: string[] = [];
  const asli = doc.text.bind(doc);
  (doc as any).text = (teks: unknown, x?: unknown, y?: unknown, opsi?: unknown) => {
    if (typeof y === "number") terbawah = Math.max(terbawah, y);
    if (typeof teks === "string") tertulis.push(teks);
    return (asli as any)(teks, x, y, opsi);
  };
  tulisBadanHarian(doc, d);
  return { terbawah, tinggiHalaman: doc.page.height, tertulis };
}

describe("blanko harian dengan banyak item", () => {
  it("REGRESI: tidak ada isi yang digambar di luar kertas", () => {
    /*
     * 40 item ± setara laporan yang dikeluhkan (20+ realisasi ditambah judul
     * kategori). Dengan pemesanan ruang yang lama, y terbawahnya menembus jauh
     * melewati tinggi halaman A4 (842 pt).
     */
    const { terbawah, tinggiHalaman } = gambarDanUkur(data(40));
    expect(terbawah).toBeLessThanOrEqual(tinggiHalaman - FORM_MARGIN);
  }, 30000);

  it("REGRESI: material melebihi kotak blanko TIDAK dibuang diam-diam", () => {
    /*
     * Kolom material dulu berhenti dengan `break` begitu kotaknya penuh: baris
     * berikutnya tidak pernah tercetak, sementara blankonya terbaca lengkap.
     * Sekarang sisanya lanjut di halaman berikutnya, jadi nama material
     * terakhir wajib ada di berkasnya.
     */
    const { tertulis, terbawah, tinggiHalaman } = gambarDanUkur(data(4, 60));
    // Aliran isi PDF dimampatkan, jadi yang diperiksa adalah teks yang
    // BENAR-BENAR diserahkan ke penggambar — bukan byte hasil akhirnya.
    expect(tertulis).toContain("Material 60");
    expect(terbawah).toBeLessThanOrEqual(tinggiHalaman - FORM_MARGIN);
  }, 30000);

  it("makin banyak item, makin banyak halaman – bukan makin banyak yang hilang", () => {
    const kecil = gambarDanUkur(data(6));
    const besar = gambarDanUkur(data(60));
    // Keduanya tetap di dalam kertas; yang membedakan hanya jumlah halamannya.
    expect(kecil.terbawah).toBeLessThanOrEqual(kecil.tinggiHalaman - FORM_MARGIN);
    expect(besar.terbawah).toBeLessThanOrEqual(besar.tinggiHalaman - FORM_MARGIN);
  }, 30000);
});

describe("kaki halaman", () => {
  it("REGRESI: menulis kaki halaman TIDAK menambah lembar kosong", () => {
    /*
     * Halaman yang dibuka pdfkit sendiri masih memakai margin bawah bakunya.
     * Kaki halaman ditulis di BAWAH margin itu, jadi pdfkit menganggapnya tidak
     * muat, membuka halaman baru, dan memindahkan kaki halamannya ke sana —
     * satu lembar kosong per pemanggilan `text()`, alias dua lembar.
     *
     * Halaman kedua di bawah sengaja dibuat TANPA mematikan paginasi otomatis,
     * meniru halaman buatan pdfkit itu.
     */
    const doc = createFormA4Doc();
    doc.addPage();
    const sebelum = doc.bufferedPageRange().count;
    kakiHalaman(doc, "MARLIN", "Laporan final");
    expect(doc.bufferedPageRange().count).toBe(sebelum);
  });
});
