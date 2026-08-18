import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIKECUALIKAN, RUTE_DINAMIS, RUTE_STATIS, polaTercakup } from "../e2e/rute-mobile";

/**
 * SETIAP HALAMAN HARUS TERJAGA PAGAR OVERFLOW MOBILE (DECISIONS 352).
 *
 * ### Kenapa uji ini ada, dan kenapa ia unit test
 *
 * Teguran user 2026-08-17: *"lagi-lagi masalah tampilan mobile. kenapa harus
 * terjadi lagi"*. Jawabannya bukan "kurang teliti" — melainkan bahwa pagarnya
 * menyapu DAFTAR RUTE YANG DITULIS TANGAN. Halaman baru lahir TIDAK TERJAGA,
 * dan tak ada apa pun yang memberi tahu. Saat keluhan itu datang aplikasi punya
 * 60 halaman dan sapuannya menyentuh sekitar setengah — termasuk melewatkan
 * halaman yang dikeluhkan.
 *
 * Uji ini menutup celahnya di tempat yang paling murah: ia hanya membaca
 * direktori, jadi ikut jalan di `pnpm vitest run tests/unit` tanpa peramban,
 * tanpa basis data, dalam hitungan milidetik. Menaruhnya di e2e berarti ia baru
 * bicara ketika seseorang menjalankan Playwright — terlalu telat, dan justru
 * pada bagian yang paling sering dilewati saat buru-buru.
 *
 * Yang dijaga: nama berkas → pola rute. Yang TIDAK dijaga di sini: apakah
 * halamannya benar-benar muat — itu tugas `tests/e2e/mobile-overflow.spec.ts`.
 * Keduanya perlu; yang satu memastikan tidak ada yang terlewat, yang satu lagi
 * memastikan yang tidak terlewat itu benar-benar diukur.
 */

const AKAR = join(process.cwd(), "src", "app", "(app)");

/** Semua rute halaman di bawah `(app)`, sebagai pola (`/lokasi/[slug]/rab`). */
function semuaPola(dir: string, awalan = ""): string[] {
  const keluar: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === "page.tsx") keluar.push(awalan === "" ? "/" : awalan);
    if (!e.isDirectory()) continue;
    // Grup rute `(nama)` tidak muncul di URL.
    const potong = /^\(.*\)$/.test(e.name) ? awalan : `${awalan}/${e.name}`;
    keluar.push(...semuaPola(join(dir, e.name), potong));
  }
  return keluar;
}

describe("pagar overflow mobile: tidak ada halaman yang lolos diam-diam", () => {
  const pola = semuaPola(AKAR).sort();

  it("direktorinya memang terbaca (kalau kosong, uji ini palsu)", () => {
    // Tanpa penjaga ini, salah jalur membuat seluruh berkas hijau tanpa
    // memeriksa apa pun — bentuk kegagalan yang paling menipu.
    expect(pola.length).toBeGreaterThan(30);
    expect(pola).toContain("/lokasi/[slug]/laporan-lokasi");
  });

  it("setiap halaman disapu, atau dikecualikan dengan alasan tertulis", () => {
    const tercakup = polaTercakup();
    const lolos = pola.filter((p) => !tercakup.has(p));
    expect(
      lolos,
      `Halaman berikut tidak terjaga pagar overflow mobile.\n` +
        `Tambahkan ke RUTE_STATIS / RUTE_DINAMIS di tests/e2e/rute-mobile.ts, ` +
        `atau ke DIKECUALIKAN beserta alasannya:\n` +
        lolos.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });

  it("daftarnya tidak menyimpan rute yang sudah dihapus", () => {
    // Daftar yang menumpuk rute mati perlahan berhenti bisa dipercaya: orang
    // berhenti membacanya, dan celah berikutnya ikut tak terlihat.
    const ada = new Set(pola);
    const hantu = [...polaTercakup()].filter((p) => !ada.has(p));
    expect(hantu, `Pola ini tidak punya halaman lagi:\n${hantu.map((p) => `  ${p}`).join("\n")}`).toEqual([]);
  });

  it("pengecualian wajib menyebut alasan yang berarti", () => {
    for (const [p, alasan] of Object.entries(DIKECUALIKAN)) {
      expect(alasan.trim().length, `alasan pengecualian ${p} terlalu pendek`).toBeGreaterThan(25);
    }
  });

  it("tidak ada pola ganda antara daftar statis dan dinamis", () => {
    const semua = [...RUTE_STATIS.map((r) => r.pola), ...RUTE_DINAMIS.map((r) => r.pola)];
    expect(semua.length).toBe(new Set(semua).size);
  });

  it("rute dinamis benar-benar bersegmen dinamis, dan statis tidak", () => {
    // Salah taruh membuat rute dinamis tidak pernah dirakit URL-nya (isi()
    // tidak dipanggil) sehingga ia hijau tanpa pernah dibuka.
    for (const r of RUTE_DINAMIS) expect(r.pola, `${r.pola} ada di daftar dinamis`).toContain("[");
    for (const r of RUTE_STATIS) expect(r.pola, `${r.pola} ada di daftar statis`).not.toContain("[");
  });
});
