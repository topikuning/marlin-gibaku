/**
 * Tipe untuk `ci-perlu.mjs`.
 *
 * Skripnya sengaja JavaScript murni: ia dijalankan `node` di dalam job CI,
 * sebelum ada langkah build apa pun — menaruh TypeScript di sana berarti
 * menambah ketergantungan pada tahap yang justru harus paling sederhana.
 * Berkas ini yang membuatnya tetap ber-tipe saat diuji dari vitest.
 */

/** Golongan satu berkas, penentu job mana yang dibutuhkan. */
export type Golongan = "dokumen" | "uji-e2e" | "uji-integrasi" | "uji-unit" | "aplikasi";

export type Pekerjaan = {
  e2e: boolean;
  integrasi: boolean;
  docker: boolean;
};

export function golongan(berkas: string): Golongan;
export function pekerjaanDibutuhkan(berkas: string[]): Pekerjaan;
