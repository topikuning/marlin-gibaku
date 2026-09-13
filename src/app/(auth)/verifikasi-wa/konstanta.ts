/**
 * Penanda "verifikasi WA sudah dilewati untuk sesi ini".
 *
 * Cookie sesi (tanpa `maxAge`): hilang saat perambannya ditutup, jadi login
 * berikutnya menanyakannya lagi — persis permintaan user, *"bisa diskip, tapi
 * sebelum dilakukan setiap kali login akan dimintai"*. Disimpan di peramban dan
 * bukan di database karena yang dicatat memang bukan fakta tentang orangnya,
 * melainkan keputusan sesaat di satu perangkat.
 *
 * DI BERKAS SENDIRI, bukan di `actions.ts`. Berkas `"use server"` HANYA boleh
 * mengekspor fungsi async — tiap ekspor di sana menjadi endpoint yang bisa
 * dipanggil peramban, jadi Next menolak yang bukan fungsi. `tsc` dan eslint
 * tidak melihatnya; yang melihatnya `next build`, dan itu berarti kegagalannya
 * baru muncul di CI/Railway. Dijaga `tests/unit/use-server-ekspor.test.ts`.
 */
export const COOKIE_LEWATI = "marlin_wa_lewati";
