/**
 * Siapkan basis AHSP jadi bentuk yang bisa DIALIRKAN saat impor. DECISIONS 325.
 *
 * ### Kenapa ada langkah ini
 *
 * Berkas master AHSP 14,6 MB, dan `JSON.parse` atasnya memuncakkan RSS **184 MB**
 * (diukur, bukan dugaan). Server produksi MARLIN berjalan di **0,5 vCPU / 512 MB**;
 * Next.js sendiri sudah memakai ~200 MB, jadi impor lewat jalur itu menabrak
 * batas memori dan prosesnya dibunuh di tengah jalan — yang sampai ke layar user
 * sebagai *"An unexpected response was received from the server"*.
 *
 * Jalan keluarnya bukan menambah RAM, melainkan tidak pernah memuat seluruh
 * berkas sekaligus. Skrip ini dijalankan SEKALI di mesin pengembang (yang punya
 * RAM), memecah master jadi:
 *
 *   - `manifest.json` — metadata sumber + `matching_engine` + sha256 BERKAS ASLI
 *   - `entri.ndjson`  — satu baris JSON per analisa, beserta komponennya
 *
 * Saat impor, `entri.ndjson` dibaca baris demi baris: memori yang dipegang cuma
 * satu potongan, bukan seluruh basis.
 *
 * Berkas master aslinya TETAP di repo — ia sumber yang sah, dipakai `pnpm
 * audit:ahsp`, dan sha256-nya yang dicatat di manifest supaya versi yang dipakai
 * menghitung uang tetap bisa dibuktikan.
 *
 * Jalankan: pnpm ahsp:siapkan
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { bacaMasterAhsp } from "@/lib/ahsp/parse";
import { AHSP_SOURCE_CODE, FOLDER_SIAP, NAMA_MANIFEST, NAMA_NDJSON } from "@/lib/ahsp/berkas";

const SEED = join(process.cwd(), "seed-data");
const MASTER = join(SEED, "ahsp-se-djbk-47-2026.json");

async function main() {
  const isi = await readFile(MASTER);
  const fileSha256 = createHash("sha256").update(isi).digest("hex");
  const master = bacaMasterAhsp(JSON.parse(isi.toString("utf8")), AHSP_SOURCE_CODE);

  const tujuan = join(SEED, FOLDER_SIAP);
  await mkdir(tujuan, { recursive: true });

  const komponen = master.entries.reduce((a, e) => a + e.components.length, 0);
  const manifest = {
    sourceCode: AHSP_SOURCE_CODE,
    fileSha256,
    masterFile: "ahsp-se-djbk-47-2026.json",
    sumber: {
      ...master.sumber,
      generatedAt: master.sumber.generatedAt.toISOString(),
    },
    ringkas: master.ringkas,
    jumlah: { entri: master.entries.length, komponen },
  };

  const tulis = createWriteStream(join(tujuan, NAMA_NDJSON), { encoding: "utf8" });
  for (const e of master.entries) {
    if (!tulis.write(`${JSON.stringify(e)}\n`)) {
      await new Promise((r) => tulis.once("drain", r));
    }
  }
  await new Promise<void>((res, rej) => {
    tulis.end((err?: Error) => (err ? rej(err) : res()));
  });

  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(tujuan, NAMA_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const ndjson = await stat(join(tujuan, NAMA_NDJSON));
  console.log(`Master  : ${MASTER}`);
  console.log(`  sha256: ${fileSha256}`);
  console.log(`Keluaran: seed-data/${FOLDER_SIAP}/`);
  console.log(`  ${NAMA_NDJSON}  ${(ndjson.size / 1048576).toFixed(1)} MB · ${master.entries.length} analisa · ${komponen} komponen`);
  console.log(`  ${NAMA_MANIFEST}`);
  if (Object.keys(master.ringkas.kategoriLain).length > 0) {
    console.log(`  kategori di luar upah/bahan/alat: ${JSON.stringify(master.ringkas.kategoriLain)}`);
  }
}

await main();
