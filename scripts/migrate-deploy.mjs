#!/usr/bin/env node
/**
 * preDeploy Railway: `prisma migrate deploy` + PEMULIHAN OTOMATIS yang aman
 * untuk migrasi yang GAGAL (P3009).
 *
 * Masalahnya: kalau satu migrasi gagal (mis. SQL salah nama kolom), Prisma
 * mencatatnya di `_prisma_migrations` dan MEMBLOKIR semua migrasi berikutnya
 * sampai dibereskan manual. Deploy berikutnya — walau SQL-nya sudah diperbaiki —
 * tetap gagal dengan pesan yang sama. Tanpa akses psql ke DB produksi, deploy
 * jadi mentok.
 *
 * Yang dilakukan skrip ini:
 *   1. `prisma migrate deploy`. Sukses → selesai.
 *   2. Gagal karena migrasi gagal → cari namanya lewat `prisma migrate status`.
 *   3. Untuk tiap migrasi gagal, PERIKSA file SQL-nya: hanya ditandai
 *      rolled-back bila file itu IDEMPOTEN — aman dijalankan ulang.
 *
 *      Ini penting dan sudah dibuktikan di Postgres sungguhan: Prisma
 *      menjalankan pernyataan migrasi SATU PER SATU, BUKAN dalam satu
 *      transaksi. Kalau baris ke-N gagal, baris 1..N-1 TETAP tersimpan.
 *      Jadi menandai rolled-back saja tidak cukup — eksekusi ulang akan
 *      menabrak objek yang terlanjur dibuat ("constraint ... already exists").
 *      Karena itu syaratnya: tiap ADD CONSTRAINT didahului DROP CONSTRAINT IF
 *      EXISTS dengan nama yang sama, dan tiap CREATE INDEX/TABLE/COLUMN memakai
 *      IF NOT EXISTS. Kalau tidak memenuhi, skrip BERHENTI dan minta
 *      penanganan manual — bukan menebak.
 *   4. `prisma migrate deploy` sekali lagi.
 *
 * Sengaja TIDAK memakai `--applied`: itu akan membohongi riwayat (menganggap
 * SQL yang gagal sudah jalan). Yang dipakai `--rolled-back`, lalu SQL versi
 * perbaikan benar-benar dieksekusi ulang.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * Alasan sebuah file migrasi TIDAK aman dijalankan ulang. Kosong = idempoten.
 * Dipakai sebagai syarat pemulihan otomatis (lihat catatan di kepala berkas).
 */
export function alasanTidakIdempoten(sqlMentah) {
  const alasan = [];
  // Komentar dibuang dulu — kalimat penjelas berbahasa Indonesia di dalamnya
  // mengandung frasa "ADD CONSTRAINT"/"CREATE INDEX" dan akan salah terbaca.
  const sql = sqlMentah.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

  // ADD CONSTRAINT tanpa DROP CONSTRAINT IF EXISTS bernama sama sebelumnya.
  const didrop = new Set(
    [...sql.matchAll(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+"?([\w]+)"?/gi)].map((m) => m[1]),
  );
  for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+"?([\w]+)"?/gi)) {
    if (!didrop.has(m[1])) alasan.push(`ADD CONSTRAINT "${m[1]}" tanpa DROP CONSTRAINT IF EXISTS`);
  }
  // CREATE INDEX / TABLE / COLUMN tanpa IF NOT EXISTS.
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\s+)(?!IF\s+NOT\s+EXISTS)"?([\w]+)"?/gi)) {
    alasan.push(`CREATE INDEX "${m[1]}" tanpa IF NOT EXISTS`);
  }
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)"?([\w]+)"?/gi)) {
    alasan.push(`CREATE TABLE "${m[1]}" tanpa IF NOT EXISTS`);
  }
  for (const m of sql.matchAll(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)"?([\w]+)"?/gi)) {
    alasan.push(`ADD COLUMN "${m[1]}" tanpa IF NOT EXISTS`);
  }
  // CREATE TYPE tidak punya bentuk IF NOT EXISTS di PostgreSQL. Satu-satunya
  // cara aman menambah enum adalah membungkusnya dalam blok DO yang memeriksa
  // pg_type lebih dulu — bentuk itu MEMANG aman dijalankan ulang, jadi bukan
  // pelanggaran. CREATE TYPE telanjang tetap ditolak (DECISIONS 176).
  const sqlTanpaTypeBerpenjaga = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/gi, (blok) =>
    /pg_type/i.test(blok) && /IF\s+NOT\s+EXISTS/i.test(blok) ? " " : blok,
  );
  for (const m of sqlTanpaTypeBerpenjaga.matchAll(/CREATE\s+TYPE\s+"?([\w]+)"?/gi)) {
    alasan.push(`CREATE TYPE "${m[1]}" tanpa penjaga pg_type (tidak bisa diulang)`);
  }
  return alasan;
}

function run(args, opts = {}) {
  const r = spawnSync("prisma", args, { encoding: "utf8", ...opts });
  if (r.error) {
    // prisma CLI global tidak ada (mis. dijalankan di luar image) → pakai npx.
    return spawnSync("npx", ["prisma", ...args], { encoding: "utf8", ...opts });
  }
  return r;
}

function log(msg) {
  console.log(`[migrate-deploy] ${msg}`);
}

function deploy() {
  const r = run(["migrate", "deploy"]);
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return r;
}

/** Nama migrasi yang tercatat GAGAL, dari output `prisma migrate status`. */
function failedMigrations() {
  const r = run(["migrate", "status"]);
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const names = new Set();
  // Format Prisma: "The `20260728020000_nama` migration started at ... failed"
  for (const m of out.matchAll(/`(\d{14}_[A-Za-z0-9_]+)`[^\n]*failed/g)) names.add(m[1]);
  // Format daftar: "Following migration have failed:\n20260728020000_nama"
  const daftar = out.match(/migrations? have failed:\s*\n([\s\S]*?)(?:\n\s*\n|$)/i);
  if (daftar) {
    for (const baris of daftar[1].split("\n")) {
      const n = baris.trim();
      if (/^\d{14}_[A-Za-z0-9_]+$/.test(n)) names.add(n);
    }
  }
  return [...names];
}

function amanDijalankanUlang(name) {
  const sql = join(MIGRATIONS_DIR, name, "migration.sql");
  if (!existsSync(sql)) {
    log(`TOLAK ${name}: file migration.sql tidak ada di image ini.`);
    return false;
  }
  const alasan = alasanTidakIdempoten(readFileSync(sql, "utf8"));
  if (alasan.length > 0) {
    log(`TOLAK ${name}: tidak idempoten, tidak aman dijalankan ulang —`);
    for (const a of alasan.slice(0, 10)) log(`  · ${a}`);
    if (alasan.length > 10) log(`  · (+${alasan.length - 10} lainnya)`);
    return false;
  }
  return true;
}

// Badan utama hanya jalan bila file ini DIEKSEKUSI langsung — supaya
// `alasanTidakIdempoten` bisa diuji unit tanpa menyentuh database.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pertama = deploy();
  if (pertama.status === 0) process.exit(0);

  const keluaran = `${pertama.stdout ?? ""}\n${pertama.stderr ?? ""}`;
  if (!/P3009|found failed migrations/i.test(keluaran)) {
    log("Gagal karena sebab lain (bukan migrasi gagal). Tidak ada pemulihan otomatis.");
    process.exit(pertama.status ?? 1);
  }

  const gagal = failedMigrations();
  if (gagal.length === 0) {
    log("Terdeteksi P3009 tapi nama migrasinya tidak terbaca. Perlu penanganan manual.");
    process.exit(pertama.status ?? 1);
  }

  log(`Migrasi tercatat gagal: ${gagal.join(", ")}`);
  for (const name of gagal) {
    if (!amanDijalankanUlang(name)) {
      log("Berhenti — DB harus diperiksa manual (lihat https://pris.ly/d/migrate-resolve).");
      process.exit(1);
    }
    log(`Menandai ${name} sebagai rolled-back (file idempoten ⇒ aman dijalankan ulang).`);
    const r = run(["migrate", "resolve", "--rolled-back", name]);
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    if (r.status !== 0) {
      log(`Gagal menandai ${name}. Berhenti.`);
      process.exit(r.status ?? 1);
    }
  }

  log("Menjalankan ulang migrate deploy setelah pemulihan…");
  const kedua = deploy();
  process.exit(kedua.status ?? 1);
}
