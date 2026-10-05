import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { latestSettings, putAiSetting } from "@/lib/ai/config";
import { env } from "@/lib/env";
import { kunciCadangan, CadanganError } from "./akun";
import { AMBANG_DB_JAM, namaBerkasDb, pilihCadanganDbDibuang, urlUntukPgDump } from "./aturan";
import { daftarDiFolder, folderAkar, hapusDiDrive, pastikanFolder, unggahResumable } from "./drive";
import { sandiStream } from "./sandi";

/**
 * CADANGAN DATABASE HARIAN KE GOOGLE DRIVE (DECISIONS 650).
 *
 *   pg_dump (format custom) → sandi AES-256-GCM → unggah resumable
 *
 * Mengalir dari ujung ke ujung: isi database tidak pernah ditampung utuh di
 * memori maupun di disk kontainer. Yang dianggap BERHASIL hanya cadangan yang
 * (1) pg_dump-nya selesai tanpa galat dan (2) sidik jari md5-nya sama dengan
 * yang dilaporkan Google. Selain itu berkasnya dihapus dari Drive – cadangan
 * setengah jadi lebih berbahaya daripada tidak ada, karena terlihat seperti
 * cadangan.
 */

const KEY_TERAKHIR = "cadangan.db_terakhir";
const KEY_GALAT = "cadangan.db_galat";

export type CatatanDb = { pada: string; nama: string; bytes: number };
export type GalatDb = { pada: string; galat: string };

export async function keadaanDb(): Promise<{ terakhir: CatatanDb | null; galat: GalatDb | null; terlambat: boolean }> {
  const s = await latestSettings([KEY_TERAKHIR, KEY_GALAT]);
  const baca = <T>(v: string | undefined): T | null => {
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  };
  const terakhir = baca<CatatanDb>(s.get(KEY_TERAKHIR));
  return {
    terakhir,
    galat: baca<GalatDb>(s.get(KEY_GALAT)),
    terlambat: terakhir ? Date.now() - new Date(terakhir.pada).getTime() > AMBANG_DB_JAM * 3_600_000 : false,
  };
}

export async function catatGalatDb(pesan: string): Promise<void> {
  await putAiSetting(KEY_GALAT, JSON.stringify({ pada: new Date().toISOString(), galat: pesan.slice(0, 500) }));
}

/** Alamat tanpa kata sandi + kata sandinya terpisah, supaya tidak tampil di daftar proses. */
function pisahSandi(url: string): { url: string; sandi: string } {
  const u = new URL(urlUntukPgDump(url));
  const sandi = decodeURIComponent(u.password);
  u.password = "";
  return { url: u.toString(), sandi };
}

export async function cadangkanDatabase(sekarang = new Date()): Promise<CatatanDb> {
  const kunci = kunciCadangan();
  if (!kunci) throw new CadanganError("BACKUP_ENCRYPTION_KEY belum diisi di Railway, jadi database tidak dicadangkan.");
  const folder = await pastikanFolder(await folderAkar(), "database");
  const nama = namaBerkasDb(sekarang);
  const { url, sandi } = pisahSandi(env.DATABASE_URL);

  const proses = spawn(
    process.env.PG_DUMP_PATH || "pg_dump",
    ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", `--dbname=${url}`],
    { env: { ...process.env, PGPASSWORD: sandi }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  proses.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  const selesai = new Promise<number>((resolve, reject) => {
    proses.on("error", (err) =>
      reject(
        new CadanganError(
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "Program pg_dump tidak ada di server. Deploy ulang memakai Dockerfile terbaru."
            : `pg_dump gagal dijalankan: ${err.message}`,
        ),
      ),
    );
    proses.on("close", (code) => resolve(code ?? 1));
  });
  selesai.catch(() => null);

  const md5 = createHash("md5");
  const hitung = new Transform({
    transform(c: Buffer, _e, cb) {
      md5.update(c);
      cb(null, c);
    },
  });
  const aliran = proses.stdout.pipe(sandiStream(kunci)).pipe(hitung);

  let hasil;
  try {
    hasil = await unggahResumable(
      {
        induk: folder,
        nama,
        mime: "application/octet-stream",
        deskripsi: "Cadangan database MARLIN (pg_dump format custom, tersandi). Buka dengan scripts/buka-cadangan.mts.",
      },
      aliran,
    );
  } catch (err) {
    proses.kill();
    throw err;
  }

  const kode = await selesai;
  const md5Lokal = md5.digest("hex");
  if (kode !== 0 || (hasil.md5 && hasil.md5 !== md5Lokal)) {
    await hapusDiDrive(hasil.id).catch(() => null);
    throw new CadanganError(
      kode !== 0
        ? `pg_dump berhenti dengan galat: ${stderr.trim().split("\n").slice(-2).join(" ") || `kode ${kode}`}`
        : "Isi cadangan di Google Drive tidak sama dengan yang dikirim – cadangan dibuang dan dicoba lagi nanti.",
    );
  }

  const catatan: CatatanDb = { pada: sekarang.toISOString(), nama, bytes: hasil.bytes };
  await putAiSetting(KEY_TERAKHIR, JSON.stringify(catatan));
  await putAiSetting(KEY_GALAT, "");

  // Retensi SESUDAH yang baru terbukti ada – tidak pernah sebelumnya.
  const dibuang = pilihCadanganDbDibuang(await daftarDiFolder(folder), sekarang);
  for (const id of dibuang) await hapusDiDrive(id).catch(() => null);
  return catatan;
}
