/**
 * RENCANA MENGECILKAN FOTO — modul MURNI, tanpa canvas dan tanpa DOM.
 *
 * Permintaan user 2026-09-03: *"kalau kamu memang bisa mengecilkan ukuran,
 * ketika besar kamu menawarkan user apakah mau kompress, kalau iya, kamu
 * kompres. itu kan ux yang ramah."*
 *
 * Benar, dan sebelumnya jawaban sistem atas foto kebesaran cuma "tidak bisa
 * dikirim" — jalan buntu di tempat yang paling tidak punya jalan keluar:
 * mandor di lapangan tidak akan membuka aplikasi lain untuk mengompres berkas,
 * ia akan berhenti melampirkan bukti.
 *
 * Yang dipisah ke sini adalah KEPUTUSANNYA (sasaran sisi panjang, tangga mutu,
 * kapan berhenti), supaya bisa diuji tanpa peramban. Pekerjaan menggambar ulang
 * piksel ada di `components/knmp/kecilkan-foto.ts`.
 *
 * ### Yang TIDAK dilakukan diam-diam
 *
 * Pengecilan hanya berjalan setelah orangnya menekan tombol. Foto adalah BUKTI:
 * mengubahnya tanpa diminta – sekalipun "cuma" ukurannya – adalah keputusan
 * yang bukan milik program. Batas 25 MB pun tidak diturunkan diam-diam; yang
 * ditawarkan cuma jalan keluar untuk foto yang memang melewatinya.
 */

import { MAX_PHOTO_BYTES } from "./photo-limits";

/**
 * Sasaran byte hasil pengecilan.
 *
 * Sengaja di BAWAH batas (25 MB), bukan tepat di batasnya: hasil `toBlob` tidak
 * bisa diramalkan sampai byte terakhir, dan hasil yang mendarat di 25,1 MB
 * berarti seluruh usaha itu sia-sia. 12 MB memberi ruang sekaligus tetap jauh
 * di atas mutu yang dibutuhkan bukti lapangan.
 */
export const SASARAN_KECIL_BYTE = 12 * 1024 * 1024;

/**
 * Sisi terpanjang hasil, dalam piksel.
 *
 * 3.000 px masih di atas kebutuhan cetak A4 300 dpi untuk foto seukuran kartu
 * pos, dan jauh di atas yang dibutuhkan layar. Foto 108 MP (12.000 px) yang
 * jadi sumber masalah ukuran turun drastis di sini, sementara detail yang
 * dipakai orang – papan nama, tulangan, patok – tetap terbaca.
 */
export const SISI_TERPANJANG_PX = 3000;

/** Tangga mutu JPEG, dicoba berurutan sampai hasilnya cukup kecil. */
export const TANGGA_MUTU = [0.85, 0.75, 0.65, 0.55] as const;

/** Perlu ditawari pengecilan? Hanya yang memang melewati batas per-foto. */
export function perluDikecilkan(bytes: number): boolean {
  return bytes > MAX_PHOTO_BYTES;
}

/**
 * Ukuran hasil setelah dibatasi sisi terpanjang, mempertahankan rasio.
 *
 * Foto yang sudah lebih kecil dari batas TIDAK diperbesar: memperbesar tidak
 * menambah satu pun detail, cuma menambah byte — kebalikan dari yang diminta.
 */
export function ukuranHasil(
  lebar: number,
  tinggi: number,
  sisiMaks = SISI_TERPANJANG_PX,
): { lebar: number; tinggi: number } {
  const terpanjang = Math.max(lebar, tinggi);
  if (terpanjang <= sisiMaks || terpanjang === 0) return { lebar, tinggi };
  const skala = sisiMaks / terpanjang;
  return {
    lebar: Math.max(1, Math.round(lebar * skala)),
    tinggi: Math.max(1, Math.round(tinggi * skala)),
  };
}

/** Nama berkas hasil — menyebut bahwa ia sudah dikecilkan, bukan menyamar. */
export function namaHasil(nama: string): string {
  const titik = nama.lastIndexOf(".");
  const dasar = titik > 0 ? nama.slice(0, titik) : nama;
  return `${dasar}-kecil.jpg`;
}

/** MB berkas untuk pesan – satu desimal, koma seperti kebiasaan Indonesia. */
export function mbFoto(byte: number): string {
  return (byte / (1024 * 1024)).toFixed(1).replace(".", ",");
}

/**
 * Apakah hasil percobaan sudah boleh diterima?
 *
 * Dua syarat, dan yang kedua sering terlupa: hasilnya harus cukup kecil DAN
 * benar-benar lebih kecil dari aslinya. JPEG bermutu tinggi atas sumber yang
 * sudah terkompresi baik bisa membengkak; menyimpan hasil yang lebih besar
 * berarti "mengecilkan" yang membesarkan.
 */
export function hasilnyaCukup(bytesHasil: number, bytesAsli: number, sasaran = SASARAN_KECIL_BYTE) {
  return bytesHasil <= sasaran && bytesHasil < bytesAsli;
}
