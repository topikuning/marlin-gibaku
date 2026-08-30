/**
 * Ringkasan keadaan draf harga AI, dan aturan kapan layar perlu menarik ulang
 * dirinya (DECISIONS 455).
 *
 * Sengaja TANPA `server-only` dan tanpa sentuhan basis data: berkas ini dibaca
 * dari kedua sisi. Server memakainya sebagai bentuk jawaban penengokan; panel
 * klien memakai aturannya untuk memutuskan apakah `router.refresh()` layak
 * dijalankan.
 *
 * Kenapa aturannya dipisah jadi fungsi sendiri: sebelum ini layar memanggil
 * `router.refresh()` tiap 3 detik tanpa syarat, dan itu menjalankan ulang
 * SELURUH kueri halaman RAPL — termasuk perhitungan atas ratusan baris RAB —
 * hanya untuk membaca satu boolean. Sebagai penangan di dalam `useEffect`, ia
 * tidak bisa diuji tanpa peramban; sebagai fungsi murni, ia bisa.
 */

export type RingkasUsulanAi = {
  /** Jawaban sedang disusun; layar harus menunggu. */
  menunggu: boolean;
  /** Penanda tunggu lewat batas — prosesnya mati sebelum menjawab. */
  terputus: boolean;
  /** Draf yang belum diterima maupun ditolak. */
  jumlahDraf: number;
};

/**
 * Apakah yang berubah di server cukup berarti untuk menarik ulang halaman.
 *
 * Ketiga medannya dibandingkan karena ketiganya mengubah yang TERLIHAT:
 * `menunggu` mengganti spanduk tunggu dengan hasilnya, `terputus` mengubahnya
 * jadi tawaran mengulang, dan `jumlahDraf` mengisi grid. Yang tidak berubah
 * tidak perlu ditarik.
 *
 * `terputus` sengaja ikut walau ia lahir dari perjalanan waktu, bukan dari
 * tulisan ke basis data: tanpa itu, permintaan yang prosesnya mati akan
 * membuat layar menunggu selamanya tanpa kabar.
 */
export function perluTarikUlang(sebelum: RingkasUsulanAi, kini: RingkasUsulanAi): boolean {
  return (
    sebelum.menunggu !== kini.menunggu ||
    sebelum.terputus !== kini.terputus ||
    sebelum.jumlahDraf !== kini.jumlahDraf
  );
}
