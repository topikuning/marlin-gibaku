/**
 * BUKA CADANGAN DATABASE MARLIN (DECISIONS 650).
 *
 * Cadangan di Google Drive (`marlin-db-YYYY-MM-DD-HHMM.dump.enc`) tersandi
 * AES-256-GCM. Skrip ini membukanya kembali menjadi berkas pg_dump biasa, yang
 * lalu dipulihkan dengan pg_restore.
 *
 *   BACKUP_ENCRYPTION_KEY="<kalimat sandi / kunci yang sama dengan di Railway>" \
 *     pnpm tsx scripts/buka-cadangan.mts marlin-db-2026-10-05-0200.dump.enc marlin.dump
 *
 *   pg_restore --no-owner --no-privileges --dbname="<DATABASE_URL tujuan>" marlin.dump
 *
 * Kunci yang salah atau berkas yang berubah satu byte pun = gagal dengan pesan
 * jelas, tidak pernah menghasilkan berkas setengah benar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { bukaSandi, kunciCadanganDari } from "../src/lib/cadangan/sandi.ts";

const [masuk, keluar] = process.argv.slice(2);
if (!masuk || !keluar) {
  console.error("Pakai: pnpm tsx scripts/buka-cadangan.mts <berkas.dump.enc> <keluaran.dump>");
  process.exit(1);
}
const kunci = kunciCadanganDari(process.env.BACKUP_ENCRYPTION_KEY);
if (!kunci) {
  console.error("BACKUP_ENCRYPTION_KEY kosong atau kurang dari 12 karakter. Pakai kalimat sandi / kunci yang sama dengan di Railway.");
  process.exit(1);
}
try {
  const isi = bukaSandi(readFileSync(masuk), kunci);
  writeFileSync(keluar, isi);
  console.log(`✓ ${keluar} – ${(isi.length / 1024 / 1024).toFixed(1)} MB. Pulihkan dengan pg_restore.`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
