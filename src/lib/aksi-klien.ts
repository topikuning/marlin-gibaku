"use client";

/**
 * Kegagalan MENGIRIM tidak boleh menghapus isian yang sudah diketik.
 *
 * Laporan user 2026-08-07, dari layar galat yang baru dipasang (DECISIONS 290):
 *
 *     Error: An unexpected response was received from the server.
 *     /lokasi/kranji-kranji/harian/2026-08-01
 *     Mozilla/5.0 (Macintosh …) Chrome/151
 *
 * Kalimat itu milik Next, bukan milik aplikasi ini. Next melemparnya di
 * `server-action-reducer` ketika balasan POST-nya bukan `text/x-component` —
 * artinya permintaannya TERKIRIM, servernya MENJAWAB, tapi yang dijawab bukan
 * hasil server action melainkan halaman galat (500/502/504 dari platform, atau
 * proses yang mati di tengah jalan). Karena aksinya sendiri tidak pernah jalan,
 * `errState` di sisi server tidak ikut bermain sama sekali.
 *
 * Dua hal salah dari cara itu berakhir di layar:
 *
 * 1. Lemparannya lolos ke batas galat, dan batas galat mengganti SELURUH
 *    halaman. Untuk sebuah form laporan, itu hasil terburuk yang mungkin:
 *    volume yang sudah diketik, pekerjaan yang sudah dipilih, foto yang sudah
 *    dilampirkan — hilang semua, gara-gara satu POST yang gagal. Pengiriman
 *    yang gagal harusnya bisa DIULANG, bukan memaksa mengetik ulang.
 * 2. Kalimatnya tidak bisa ditindaklanjuti siapa pun di lapangan.
 *
 * Pembungkus ini mengubah kegagalan transport jadi PESAN di form yang sama:
 * isian tetap utuh, tombolnya bisa ditekan lagi. Nama galat aslinya tetap
 * ditulis supaya laporan berikutnya tetap membawa fakta.
 *
 * BUKAN untuk galat logika. Galat yang berasal dari dalam aksi (validasi, izin,
 * kegagalan simpan) sudah ditangani di sisi server dan tetap lewat apa adanya.
 */

export type AksiState = { error?: string; success?: string; warning?: string } | undefined;

/**
 * Apakah server masih menjawab sama sekali?
 *
 * Membedakan dua kegagalan yang di layar terlihat sama persis tapi jalan
 * keluarnya berbeda: "server sedang mati/restart — tunggu lalu ulangi" versus
 * "server hidup, tapi permintaan INI yang ditolak — mengulang tidak menolong".
 * Tanpa pembeda ini, laporan berikutnya tetap tidak bisa ditindaklanjuti.
 */
async function serverMenjawab(): Promise<boolean> {
  try {
    const r = await fetch("/api/health", { method: "GET", cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

export function tahanGagalKirim<S extends AksiState>(
  aksi: (prev: S, data: FormData) => Promise<S>,
): (prev: S, data: FormData) => Promise<S> {
  return async (prev, data) => {
    try {
      return await aksi(prev, data);
    } catch (err) {
      // `redirect()`/`notFound()` Next bekerja DENGAN cara melempar — menelannya
      // akan merusak navigasi. Sama seperti aturan di sisi server.
      const digest = (err as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;

      const nama = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[marlin] pengiriman gagal", err);
      const hidup = await serverMenjawab();
      return {
        error: hidup
          ? `Gagal mengirim — server menolak permintaan ini. Isian di layar TIDAK hilang; coba tekan lagi, dan kalau tetap gagal laporkan pesan ini: ${nama}`
          : `Gagal mengirim — server sedang tidak bisa dihubungi. Isian di layar TIDAK hilang; tunggu sebentar lalu tekan lagi. (${nama})`,
      } as S;
    }
  };
}
