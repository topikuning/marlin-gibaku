import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * PENYIAPAN MAPLIBRE DI KLIEN — satu tempat, dipanggil kedua peta.
 *
 * Dua hal yang harus terjadi SEBELUM `new maplibregl.Map(...)`, dan keduanya
 * kalau lupa gagal dengan diam:
 *
 * 1. **Alamat worker.** MapLibre 6 menggambar ubin di dalam Web Worker, dan
 *    workernya modul ES yang mengimpor berkas sebelahnya
 *    (`./maplibre-gl-shared.mjs`). Next menyalin worker itu ke
 *    `/_next/static/media/…<hash>.mjs` APA ADANYA — impor relatifnya tidak
 *    ditulis ulang, sedangkan tetangganya ikut di-hash jadi nama lain. Worker
 *    menunjuk alamat yang tidak ada, gagal dimuat, dan `new Worker()` yang
 *    skripnya 404 TIDAK melempar apa pun.
 *
 *    Yang terlihat di layar persis keluhan user 2026-09-06 (*"berhasil
 *    didownload, tapi malah jadi abu2. apa masalahmu sebenarnya!"*): gaya
 *    termuat, kepala `.pmtiles` terbaca sekali, lalu berhenti — tanpa satu pun
 *    permintaan ubin, tanpa pesan galat, menyisakan lapisan latar Protomaps
 *    `#cccccc`. Berbulan-bulan bisa terbaca "peta rusak" tanpa satu petunjuk
 *    pun. Jadi workernya disajikan dari asal kita sendiri, berdampingan dengan
 *    berkas yang diimpornya (disalin tiap build oleh
 *    `scripts/salin-worker-peta.mjs`).
 *
 * 2. **Protokol `pmtiles://`**, sekali per halaman.
 */

/** Jalur worker yang disalin `scripts/salin-worker-peta.mjs` ke `public/`. */
export const JALUR_WORKER = "/maplibre/maplibre-gl-worker.mjs";

let siap = false;

export function siapkanPeta() {
  if (siap) return;
  maplibregl.setWorkerUrl(JALUR_WORKER);
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  siap = true;
}
