/**
 * Instrumentation Next.js — pola resmi: logika node-only dipisah ke
 * instrumentation-node.ts dan di-import di balik guard NEXT_RUNTIME
 * (di-inline saat build → bundle edge membuang cabang ini; tanpa pola ini
 * build gagal karena argon2/fs ikut ke bundle edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    /*
     * `bootstrapDone` DITUNGGU (review 2026-08-29).
     *
     * `await import(...)` hanya menunggu modulnya dimuat — IIFE bootstrap di
     * dalamnya baru DIMULAI, bukan selesai. Server karenanya bisa melayani
     * permintaan selagi migrasi data masih berjalan: enkripsi ulang rahasia,
     * pembekuan rentang periode snapshot, konversi mode minggu. Yang lahir dari
     * situ adalah angka yang benar pada permintaan berikutnya dan salah pada
     * permintaan pertama — kelas kesalahan yang paling sulit dilacak karena
     * tidak bisa diulang.
     *
     * `register()` memang tempatnya: Next menjalankannya sekali, sebelum
     * permintaan pertama dilayani. Seluruh langkah di dalamnya idempoten dan
     * masing-masing sudah ber-`try/catch` sendiri, jadi satu langkah yang gagal
     * tidak menahan boot — ia tercatat dan dicoba lagi boot berikutnya.
     */
    const { bootstrapDone } = await import("./instrumentation-node");
    await bootstrapDone;
  }
}
