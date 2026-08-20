// GALAT DI SISI PERAMBAN HARUS PUNYA NAMA DAN HARUS BISA DIBACA DI PONSEL.
//
// Laporan user 2026-08-07: *"error terjadi sepertinya sebelum browser kirim
// request, bahkan di server tidak ada log"*. Memang begitu — aplikasi ini tidak
// punya SATU PUN error boundary, jadi setiap lemparan di klien mengganti seluruh
// halaman dengan layar bawaan Next ("application error, reload") yang tidak
// menyebut apa-apa. Tidak ada permintaan yang pernah dikirim, jadi log server
// pun kosong. Pelapor kami bekerja dengan ponsel: tidak ada console, tidak ada
// inspect element. Kombinasi itu = kegagalan yang mustahil didiagnosis.
//
// Uji ini mengunci dua hal yang mudah hilang saat refactor:
//   1. Batas galat ADA dan memakai panel yang menyebut nama galatnya.
//   2. Perakitan `DataTransfer` di input foto DIJAGA, bukan telanjang.
//
// Diperiksa dari sumbernya karena keduanya soal STRUKTUR berkas — batas galat
// hanya bekerja kalau berkasnya ada di jalur yang tepat, dan itu tidak bisa
// dibuktikan lewat pemanggilan fungsi.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("batas galat klien", () => {
  it("ada di segmen aplikasi dan di akar", () => {
    expect(existsSync("src/app/(app)/error.tsx")).toBe(true);
    expect(existsSync("src/app/global-error.tsx")).toBe(true);
  });

  it("keduanya memakai panel yang menyebut galatnya, bukan teks umum", () => {
    for (const p of ["src/app/(app)/error.tsx", "src/app/global-error.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src).toContain("PanelGalat");
      expect(src).toContain("error={error}");
    }
  });

  it("panel menulis nama + pesan galat, alamat halaman, dan identitas peramban", () => {
    const src = readFileSync("src/components/shell/panel-galat.tsx", "utf8");
    // Nama DAN pesan — "Terjadi kesalahan" saja tidak bisa ditindaklanjuti.
    expect(src).toContain("${error.name}: ${error.message}");
    expect(src).toContain("error.digest");
    // Tanpa ini, galat yang cuma muncul di satu peramban mustahil dipersempit.
    expect(src).toContain("navigator.userAgent");
    expect(src).toContain("window.location.pathname");
  });
});

describe("perakitan DataTransfer di input foto", () => {
  const src = readFileSync("src/components/knmp/photo-source-input.tsx", "utf8");

  it("dijaga try/catch – tidak boleh menjatuhkan halaman", () => {
    // Baris KODE-nya, bukan penyebutan `new DataTransfer()` di komentar.
    const i = src.indexOf("const dt = new DataTransfer();");
    expect(i).toBeGreaterThan(-1);
    // try-nya harus MEMBUNGKUS, bukan sekadar ada di berkas yang sama.
    expect(src.slice(Math.max(0, i - 120), i)).toMatch(/try\s*\{/);
    expect(src.slice(i, i + 700)).toMatch(/catch\s*\(/);
  });

  it("hasil penugasan diperiksa, bukan cuma 'tidak melempar'", () => {
    // Peramban yang menerima penugasan lalu mengabaikannya akan mengirim form
    // tanpa foto — gagal diam-diam, yang terburuk untuk bukti lapangan.
    expect(src).toContain("el.files.length !== berkas.length");
  });

  it("punya jalur cadangan: pemilih sendiri yang ber-name saat perakitan gagal", () => {
    // Nama medannya kini lewat `n()` supaya bisa diberi awalan per baris
    // (DECISIONS 343) — yang dijaga tetap sama: di jalur cadangan pemilihnya
    // yang ber-name, dan input perakit justru melepas name-nya supaya tidak
    // mengirim daftar kosong yang menimpa pilihan asli.
    expect(src).toContain('name={rakitGagal ? n("photos") : undefined}');
    expect(src).toContain('name={rakitGagal ? undefined : n("photos")}');
  });

  it("SELURUH medan foto ikut awalan – tidak ada yang tertinggal bernama tetap", () => {
    /*
     * Satu medan yang lupa diberi awalan cukup untuk menukar bukti: `photoLat`
     * baris ke-3 akan menimpa milik baris ke-1 karena namanya sama, dan cap
     * foto memakai koordinat baris yang salah tanpa satu pun galat.
     */
    for (const medan of ["photoSource", "galleryAtSite", "photoTakenAt", "photos"]) {
      expect(src, medan).toContain(`n("${medan}")`);
    }
    // Nama tetap (tanpa `n(`) tidak boleh tersisa pada ATRIBUT name.
    // Yang di dalam backtick adalah kutipan di komentar, bukan kode — versi
    // pertama pemeriksa ini ikut menangkapnya dan merah karena sebuah kalimat.
    const tetap = [...src.matchAll(/(?<!`)name="(photo[A-Za-z]*|photos|galleryAtSite)"/g)];
    expect(tetap.map((m) => m[0]), "masih ada medan foto bernama tetap").toEqual([]);
  });

  it("menyebut nama galatnya di layar, bukan menelannya diam-diam", () => {
    expect(src).toContain("{rakitGagal}");
  });
});
