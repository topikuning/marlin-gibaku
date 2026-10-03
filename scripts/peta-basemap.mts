/**
 * BANGUN PETA DASAR MARLIN (`.pmtiles`) — hasilnya ditempelkan ke rilis.
 *
 * Ketetapan user 2026-09-06: peta dasar milik sendiri — tanpa kunci API, tanpa
 * kuota, tanpa pihak ketiga yang bisa memblokir peta proyek pemerintah di
 * tengah jalan. Dan setelah teguran hari yang sama, ia TIDAK diunggah ke R2:
 * R2 dev dan produksi berbeda, jadi satu berkas di sana cuma melayani salah
 * satunya. Berkas hasil skrip ini ditempelkan ke RILIS GitHub, lalu tiap
 * lingkungan mengunduhnya ke VOLUME-nya sendiri lewat tombol di /sistem.
 *
 * Cara kerjanya, dan kenapa begini:
 *
 * Protomaps menerbitkan basemap sedunia sebagai SATU berkas `.pmtiles` di
 * `build.protomaps.com`. Berkas itu ratusan gigabyte — tapi formatnya memang
 * dirancang untuk tidak diunduh utuh: `pmtiles extract` hanya menarik potongan
 * yang berada di dalam kotak wilayah yang diminta, lewat permintaan HTTP Range.
 * Untuk Indonesia sampai zoom 12, yang terunduh tinggal sebagian kecil.
 *
 * Zoom 12 bukan angka sembarangan: di atas itu MARLIN memakai CITRA SATELIT,
 * karena yang dikerjakan orang pada perbesaran tinggi adalah membuktikan sebuah
 * titik benar-benar di kampung nelayan — dan itu dijawab citra, bukan peta
 * jalan. Tiap tingkat zoom melipatempatkan jumlah ubin, jadi berhenti di 12
 * memangkas berkasnya secara besar tanpa kehilangan satu pun kegunaan.
 *
 * Dijalankan CI (`.github/workflows/peta-basemap.yml`):
 *   pnpm peta:basemap
 *
 * Perlu: binari `pmtiles` (Go, dipasang workflow). TIDAK perlu kredensial apa
 * pun — keluarannya berkas biasa.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

/** Kotak wilayah Indonesia: barat–selatan–timur–utara. */
const BBOX = "94.9,-11.2,141.1,6.3";
/** Di atas ini MARLIN memakai citra satelit — lihat catatan di kepala berkas. */
const ZOOM_MAKS = 12;

/**
 * Build Protomaps terbaru yang masih tersedia. Dulu tanggalnya dipatok
 * (20260901): Protomaps hanya menyimpan build beberapa minggu terakhir, jadi
 * jalan terjadwal bulan berikutnya gagal karena berkasnya sudah dihapus.
 * Sekarang dicari mundur dari hari ini sampai ketemu yang ada.
 */
async function buildTerbaru(): Promise<string> {
  for (let mundur = 0; mundur <= 45; mundur++) {
    const tanggal = new Date(Date.now() - mundur * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    const url = `https://build.protomaps.com/${tanggal}.pmtiles`;
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
      if (res.ok) return url;
    } catch {
      /* coba tanggal sebelumnya */
    }
  }
  console.error("✗ Tidak ada build Protomaps dalam 45 hari terakhir. Isi PETA_BUILD_URL secara manual.");
  process.exit(1);
}

const sumber = process.env.PETA_BUILD_URL?.trim() || (await buildTerbaru());
const keluaran = process.env.PETA_KELUARAN?.trim() || "basemap-indonesia.pmtiles";

console.log(`▸ Mengekstrak Indonesia (bbox ${BBOX}, zoom ≤ ${ZOOM_MAKS}) dari ${sumber}`);
const ekstrak = spawnSync(
  "pmtiles",
  ["extract", sumber, keluaran, `--bbox=${BBOX}`, `--maxzoom=${ZOOM_MAKS}`],
  { stdio: "inherit" },
);
if (ekstrak.status !== 0) {
  console.error("✗ pmtiles extract gagal. Binari `pmtiles` terpasang?");
  process.exit(1);
}

const ukuran = statSync(keluaran).size;
console.log(`✓ ${keluaran} — ${(ukuran / 1024 / 1024).toFixed(1)} MB`);
console.log("  Workflow menempelkannya ke rilis GitHub; aplikasi mengunduhnya");
console.log("  ke VOLUME masing-masing lingkungan lewat tombol di /sistem.");
