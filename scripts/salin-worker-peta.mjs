/**
 * SALIN WORKER MAPLIBRE KE `public/maplibre/` — sebelum build & sebelum dev.
 *
 * KENAPA ADA BERKAS INI (kegagalan produksi 2026-09-06: *"berhasil didownload,
 * tapi malah jadi abu2"*).
 *
 * MapLibre 6 menggambar ubin di dalam Web Worker, dan workernya sebuah MODUL
 * ES yang mengimpor berkas sebelahnya:
 *
 *     // node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs
 *     import { ... } from "./maplibre-gl-shared.mjs";
 *
 * Next menyalin worker itu ke `/_next/static/media/maplibre-gl-worker.<hash>.mjs`
 * APA ADANYA — impor relatifnya tidak ditulis ulang, padahal berkas sebelahnya
 * ikut di-hash jadi nama lain. Jadi worker menunjuk alamat yang tidak ada,
 * gagal dimuat, dan **kegagalannya tidak melempar**: `new Worker(url)` yang
 * skripnya 404 hanya memancarkan event error yang tidak didengarkan siapa pun.
 *
 * Akibatnya persis yang dikeluhkan: peta memuat gayanya, mengambil kepala
 * `.pmtiles` satu kali, lalu BERHENTI — tidak ada satu pun permintaan ubin,
 * tidak ada pesan galat, dan yang tersisa di layar cuma lapisan latar
 * Protomaps: abu-abu polos `#cccccc`.
 *
 * Perbaikannya menyajikan worker + berkas sebelahnya dari asal kita sendiri,
 * berdampingan, sehingga impor relatifnya tetap benar. Disalin dari
 * `node_modules` tiap build supaya versinya tidak mungkin melenceng dari
 * pustaka yang dipakai halaman.
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Worker dan berkas yang diimpornya — keduanya WAJIB berdampingan. */
const BERKAS = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

/** Alamat yang diumumkan ke MapLibre lewat `setWorkerUrl` (lihat lib/peta/klien.ts). */
export const DIR_PUBLIK = path.join("public", "maplibre");

function main() {
  const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));
  const tujuan = path.join(process.cwd(), DIR_PUBLIK);
  mkdirSync(tujuan, { recursive: true });

  for (const nama of BERKAS) {
    const asal = path.join(dist, nama);
    if (!existsSync(asal)) {
      throw new Error(
        `maplibre-gl tidak lagi memuat ${nama}. Susunan berkasnya berubah – periksa dist/ pustaka itu dan perbarui scripts/salin-worker-peta.mjs sebelum melanjutkan.`,
      );
    }
    copyFileSync(asal, path.join(tujuan, nama));
  }

  // Anggapan yang membuat perbaikan ini bekerja, diperiksa alih-alih dipercaya:
  // worker HARUS mengimpor tetangganya lewat jalur relatif. Kalau suatu saat
  // tidak lagi, menyalin dua berkas ini tidak cukup — dan lebih baik build
  // berhenti di sini daripada peta abu-abu lagi di produksi.
  const isi = readFileSync(path.join(tujuan, "maplibre-gl-worker.mjs"), "utf8");
  if (!isi.includes('"./maplibre-gl-shared.mjs"')) {
    throw new Error(
      "worker maplibre tidak lagi mengimpor ./maplibre-gl-shared.mjs – perbaikan worker peta perlu ditinjau ulang.",
    );
  }
  console.log(`[peta] worker maplibre disalin ke ${DIR_PUBLIK}/`);
}

main();
