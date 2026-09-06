/**
 * BUAT & UNGGAH PETA DASAR MARLIN (`.pmtiles`) KE R2.
 *
 * Ketetapan user 2026-09-06: peta dasar disimpan sendiri di R2 — tanpa kunci
 * API, tanpa kuota, tanpa pihak ketiga yang bisa memblokir peta proyek
 * pemerintah di tengah jalan.
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
 * Dijalankan CI (`.github/workflows/peta-basemap.yml`), bukan tangan orang:
 *   pnpm peta:basemap
 *
 * Perlu: binari `pmtiles` (Go, dipasang workflow) + kredensial R2 di env yang
 * SAMA dengan yang dipakai aplikasi.
 */
import { spawnSync } from "node:child_process";
import { statSync, unlinkSync } from "node:fs";
import { createReadStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

/** Kotak wilayah Indonesia: barat–selatan–timur–utara. */
const BBOX = "94.9,-11.2,141.1,6.3";
/** Di atas ini MARLIN memakai citra satelit — lihat catatan di kepala berkas. */
const ZOOM_MAKS = 12;

const sumber = process.env.PETA_BUILD_URL?.trim() || "https://build.protomaps.com/20260901.pmtiles";
const kunci = process.env.PETA_PMTILES_KEY?.trim() || "peta/basemap.pmtiles";
const berkas = "/tmp/marlin-basemap.pmtiles";

function wajib(nama: string): string {
  const v = process.env[nama]?.trim();
  if (!v) {
    console.error(`✗ ${nama} kosong. Skrip ini butuh kredensial R2 yang sama dengan aplikasi.`);
    process.exit(1);
  }
  return v;
}

const endpoint = wajib("R2_ENDPOINT");
const bucket = wajib("R2_BUCKET");
const accessKeyId = wajib("R2_ACCESS_KEY_ID");
const secretAccessKey = wajib("R2_SECRET_ACCESS_KEY");

console.log(`▸ Mengekstrak Indonesia (bbox ${BBOX}, zoom ≤ ${ZOOM_MAKS}) dari ${sumber}`);
const ekstrak = spawnSync(
  "pmtiles",
  ["extract", sumber, berkas, `--bbox=${BBOX}`, `--maxzoom=${ZOOM_MAKS}`],
  { stdio: "inherit" },
);
if (ekstrak.status !== 0) {
  console.error("✗ pmtiles extract gagal. Binari `pmtiles` terpasang?");
  process.exit(1);
}

const ukuran = statSync(berkas).size;
console.log(`▸ Berkas jadi: ${(ukuran / 1024 / 1024).toFixed(1)} MB`);

const s3 = new S3Client({
  region: "auto",
  endpoint: endpoint.startsWith("http") ? endpoint : `https://${endpoint}`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

// Diunggah berpotongan (multipart): berkas ratusan MB tidak boleh ditahan utuh
// di memori runner CI.
const unggah = new Upload({
  client: s3,
  params: {
    Bucket: bucket,
    Key: kunci,
    Body: createReadStream(berkas),
    ContentType: "application/octet-stream",
  },
  queueSize: 4,
  partSize: 16 * 1024 * 1024,
});
unggah.on("httpUploadProgress", (p) => {
  if (p.loaded && p.total) process.stdout.write(`\r  ${Math.round((p.loaded / p.total) * 100)}%`);
});
await unggah.done();
process.stdout.write("\n");
unlinkSync(berkas);

console.log(`✓ Peta dasar terpasang di R2: ${bucket}/${kunci}`);
console.log("  MARLIN memakainya otomatis pada permintaan halaman berikutnya – tanpa deploy ulang.");
