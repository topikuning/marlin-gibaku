"use client";

import { useActionState, useMemo } from "react";

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

/**
 * Kegagalan ini akibat deploy yang menyalip tab, bukan gangguan sesaat.
 *
 * Dikenali dari NAMA galatnya (`UnrecognizedActionError`, yang dilempar Next
 * saat server membalas header action-not-found) DAN dari kalimatnya, karena
 * nama kelas galat internal Next bisa berubah antar versi sementara pesannya
 * jauh lebih stabil. Salah satu cocok sudah cukup.
 */
function basiKarenaDeploy(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "UnrecognizedActionError" ||
    /was not found on the server|failed to find server action/i.test(err.message)
  );
}

export function tahanGagalKirim<S extends AksiState>(
  aksi: (prev: S, data: FormData) => Promise<S>,
): (prev: S, data: FormData) => Promise<S>;
export function tahanGagalKirim<S>(
  aksi: (prev: S, data: FormData) => Promise<S>,
  saatGagal: (pesan: string) => S,
): (prev: S, data: FormData) => Promise<S>;
export function tahanGagalKirim<S>(
  aksi: (prev: S, data: FormData) => Promise<S>,
  saatGagal?: (pesan: string) => S,
): (prev: S, data: FormData) => Promise<S> {
  const galat = saatGagal ?? ((pesan: string) => ({ error: pesan }) as S);
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

      /**
       * Tab lebih tua daripada servernya (DECISIONS 292).
       *
       * ID server action di-hash per build; sesudah deploy, halaman yang sudah
       * telanjur terbuka membawa ID yang tidak ada lagi di server dan Next
       * menolaknya lewat header `x-nextjs-action-not-found`. Ini BUKAN "server
       * menolak permintaan ini" — servernya sehat, tabnya yang usang, dan satu-
       * satunya jalan keluar adalah memuat ulang. Menekan tombolnya lagi tidak
       * akan pernah berhasil, jadi jangan menyuruh mencoba lagi.
       */
      if (basiKarenaDeploy(err)) {
        return galat(
          "MARLIN sudah diperbarui sejak halaman ini dibuka, jadi kiriman dari halaman lama ini ditolak. " +
            "Muat ulang halaman lalu ulangi – mencoba lagi tanpa memuat ulang tidak akan berhasil. " +
            "Catat dulu isian yang belum tersimpan; foto perlu dilampirkan ulang.",
        );
      }

      const hidup = await serverMenjawab();
      return galat(
        hidup
          ? `Gagal mengirim – server menolak permintaan ini. Isian di layar TIDAK hilang; coba tekan lagi, dan kalau tetap gagal laporkan pesan ini: ${nama}`
          : `Gagal mengirim – server sedang tidak bisa dihubungi. Isian di layar TIDAK hilang; tunggu sebentar lalu tekan lagi. (${nama})`,
      );
    }
  };
}

/**
 * `useActionState` yang SELALU terjaga dari kegagalan transport.
 *
 * Keluhan user 2026-09-04, di layar laporan harian, untuk kesekian kalinya:
 * halaman berhenti dengan *"An unexpected response was received from the
 * server"* dan seluruh isian yang belum sempat disimpan hilang.
 *
 * Penjaganya sudah ada sejak DECISIONS 290/295 — tapi dipasang SATU-SATU di
 * tempat yang kebetulan diingat. Di halaman yang sama, `report-editor`
 * memakainya sementara `enrichment-form` (cuaca, tenaga kerja, material, alat
 * — termasuk unggahan foto, muatan terbesar di halaman itu) tidak. Jadi
 * kegagalan yang persis sama berakhir dua cara berbeda tergantung tombol mana
 * yang ditekan, dan yang tidak terjaga justru yang paling berat muatannya.
 *
 * Penjaga yang harus DIINGAT bukan penjaga; ia cuma menunda kejadian
 * berikutnya. Karena itu pembungkusnya tidak lagi opsional: seluruh layar
 * memanggil `useAksi`, dan `useActionState` telanjang dijaga tetap tidak
 * dipakai di luar berkas ini oleh `tests/unit/aksi-terjaga.test.ts`.
 */
export function useAksi<S extends AksiState>(
  aksi: (prev: S, data: FormData) => Promise<S>,
  awal: S,
): [S, (data: FormData) => void, boolean];
/**
 * Keadaan yang BENTUKNYA lain (mis. union ber-`ok`) tetap dijaga, tapi harus
 * menyebutkan sendiri cara menyatakan kegagalan — pembungkusnya tidak boleh
 * menebak bentuk yang tidak ia kenal.
 */
export function useAksi<S>(
  aksi: (prev: S, data: FormData) => Promise<S>,
  awal: S,
  saatGagal: (pesan: string) => S,
): [S, (data: FormData) => void, boolean];
export function useAksi<S>(
  aksi: (prev: S, data: FormData) => Promise<S>,
  awal: S,
  saatGagal?: (pesan: string) => S,
): [S, (data: FormData) => void, boolean] {
  // Identitas pembungkus mengikuti aksinya: kalau tidak, tiap render membuat
  // fungsi baru dan React menganggap aksinya berganti.
  const dijaga = useMemo(
    () => tahanGagalKirim(aksi, saatGagal ?? ((pesan: string) => ({ error: pesan }) as S)),
    [aksi, saatGagal],
  );
  return useActionState<S, FormData>(dijaga, awal as Awaited<S>) as unknown as [
    S,
    (data: FormData) => void,
    boolean,
  ];
}
