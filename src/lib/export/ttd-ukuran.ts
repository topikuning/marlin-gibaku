/**
 * UKURAN tanda tangan & stempel pada dokumen cetak — SATU sumber untuk penyaji
 * HTML (`components/knmp/blok-ttd.tsx`) dan penyaji PDF (`lib/pdf/ttd-gambar.ts`).
 * DECISIONS 328 → 329 → **330**.
 *
 * ### Acuan ukurannya sempat SALAH, dan itu akar dua koreksi user
 *
 * Versi 328/329 menskalakan semuanya dari **tinggi celah tanda tangan** (40–56
 * px). Celah itu kecil, jadi stempelnya ikut kecil — user mengoreksi dua kali,
 * yang kedua: *"kenapa makin kecil, bukan makin mengikuti contoh!"*
 *
 * Foto dokumen aslinya menunjukkan acuan yang benar: **garis tengah stempel ≈
 * selebar baris nama perusahaan**, bukan setinggi celah. Memang begitu benda
 * aslinya — stempel bundar ±4 cm pada kolom tanda tangan ±6–7 cm, jadi ia
 * memakan sekitar 55–60% LEBAR kolomnya dan dengan sendirinya melimpah jauh ke
 * atas menimpa baris teks. Celahnya yang mengalah pada stempel, bukan
 * sebaliknya.
 *
 * Karena itu ukuran sekarang diturunkan dari **lebar kolom**, dengan tinggi
 * celah hanya sebagai BATAS ATAS supaya pada dokumen bertulisan kecil (lembar
 * kurva-S) stempelnya tidak menelan blok di atasnya.
 *
 *   ukuran = min(persentase lebar kolom, kelipatan tinggi celah)
 *
 * HTML memakai `min()` CSS dengan dua angka yang sama persis, sehingga tidak
 * perlu tahu lebar kolomnya saat render.
 *
 * Modul ini MURNI (tanpa I/O, tanpa React) supaya bisa diuji langsung.
 */

/** Garis tengah stempel, % LEBAR kolom tanda tangan. Stempel ±4 cm di kolom ±7 cm. */
export const PERSEN_STEMPEL = 56;
/** Lebar coretan tanda tangan, % lebar kolom. Coretan ±5–6 cm — lebih lebar dari stempel. */
export const PERSEN_TTD = 66;

/**
 * Batas atas terhadap TINGGI celah. Bukan penentu ukuran, hanya rem — tapi rem
 * yang memang sering menggigit: kolom tanda tangan di layar jauh lebih lebar
 * (relatif terhadap ukuran hurufnya) daripada kolom 6–7 cm di kertas A4, jadi
 * aturan persen-lebar sendirian akan melar.
 *
 * Angkanya disetel dari foto dokumen asli: di sana garis tengah stempel ≈ 11×
 * tinggi huruf. 2,3 × celah menghasilkan kira-kira itu pada ketujuh dokumen.
 */
export const BATAS_STEMPEL = 2.3;
/** Coretan lebih rendah daripada stempel — bandingkan tinggi benda aslinya. */
export const BATAS_TTD = 1.2;

/** Nisbah lebar : tinggi coretan tanda tangan. Memanjang, bukan bujur sangkar. */
export const BENTUK_TTD = 2.0;

/**
 * Geseran stempel ke kiri, terhadap LEBAR STEMPEL SENDIRI. Meniru cara orang
 * membubuhkannya: dicap menimpa sisi kiri coretan, bukan berdiri terpisah.
 * Dinyatakan terhadap dirinya sendiri supaya di HTML bisa jadi persen `transform`
 * (persen `translateX` memang relatif ke elemen itu sendiri).
 */
export const GESER_STEMPEL = 0.2;

/**
 * Stempel TURUN menimpa baris nama, terhadap tinggi stempel sendiri.
 *
 * Di dokumen asli stempel membentang dari baris nama perusahaan sampai menimpa
 * nama penanda tangan di bawahnya — jadi sisi bawahnya memang melewati garis
 * pijak sedikit. Yang membuat nama tetap terbaca adalah `mix-blend-multiply`:
 * tinta di atas tinta, bukan kotak putih yang menutup.
 */
export const TURUN_STEMPEL = 0.06;

export type UkuranTtd = {
  stempel: { lebar: number; tinggi: number };
  ttd: { lebar: number; tinggi: number };
  /** Geseran stempel ke KIRI dari titik tengah kolom. */
  geser: number;
  /** Stempel turun sekian dari garis pijak (menimpa baris nama). */
  turun: number;
};

/**
 * Turunkan ukuran gambar dari LEBAR kolom tanda tangan, direm tinggi celahnya.
 *
 * @param lebarKolom lebar kolom tanda tangan (px untuk HTML, poin untuk PDF)
 * @param tinggiCelah tinggi ruang tanda tangan — hanya batas atas
 */
export function ukuranTtd(lebarKolom: number, tinggiCelah: number): UkuranTtd {
  const stempel = Math.round(
    Math.min((lebarKolom * PERSEN_STEMPEL) / 100, tinggiCelah * BATAS_STEMPEL),
  );
  const ttdTinggi = Math.round(
    Math.min((lebarKolom * PERSEN_TTD) / 100 / BENTUK_TTD, tinggiCelah * BATAS_TTD),
  );
  return {
    // Stempel bundar: lebar = tinggi.
    stempel: { lebar: stempel, tinggi: stempel },
    ttd: { lebar: Math.round(ttdTinggi * BENTUK_TTD), tinggi: ttdTinggi },
    geser: Math.round(stempel * GESER_STEMPEL),
    turun: Math.round(stempel * TURUN_STEMPEL),
  };
}
