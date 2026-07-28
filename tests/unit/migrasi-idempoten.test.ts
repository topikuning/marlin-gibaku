import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — skrip preDeploy sengaja .mjs polos (dijalankan di image runner).
import { alasanTidakIdempoten } from "../../scripts/migrate-deploy.mjs";

/**
 * MIGRASI HARUS IDEMPOTEN (DECISIONS 167).
 *
 * Fakta yang membuat aturan ini wajib — dibuktikan di PostgreSQL 16 sungguhan
 * saat deploy 28 Juli 2026 gagal: Prisma menjalankan pernyataan migrasi SATU
 * PER SATU, BUKAN dalam satu transaksi. Kalau pernyataan ke-N gagal, 1..N-1
 * TETAP tersimpan, lalu migrasi tercatat gagal dan MEMBLOKIR semua deploy
 * berikutnya. Menandainya rolled-back saja tidak menolong: eksekusi ulang
 * menabrak objek yang terlanjur dibuat.
 *
 * Karena itu migrasi baru wajib aman dijalankan ulang. Penjaganya memakai
 * fungsi yang SAMA dengan yang dipakai scripts/migrate-deploy.mjs saat
 * memulihkan deploy, supaya aturan dan penegakannya tidak pernah berbeda.
 *
 * Berlaku untuk migrasi 28 Juli 2026 ke atas. Migrasi lama dibiarkan apa
 * adanya — sudah terpasang di semua lingkungan, mengubahnya justru berisiko.
 */

const DIR = join(process.cwd(), "prisma", "migrations");
const BERLAKU_SEJAK = "20260728000000";

describe("migrasi Prisma: aman dijalankan ulang", () => {
  const baru = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name >= BERLAKU_SEJAK)
    .map((d) => d.name)
    .sort();

  it("ada migrasi baru yang tercakup aturan ini", () => {
    expect(baru.length).toBeGreaterThan(0);
  });

  for (const name of baru) {
    it(`${name} idempoten`, () => {
      const sql = readFileSync(join(DIR, name, "migration.sql"), "utf8");
      expect(alasanTidakIdempoten(sql)).toEqual([]);
    });
  }
});

describe("pendeteksi idempoten (dipakai preDeploy untuk memutuskan pemulihan)", () => {
  it("menolak ADD CONSTRAINT tanpa DROP CONSTRAINT IF EXISTS", () => {
    const alasan = alasanTidakIdempoten('ALTER TABLE "a" ADD CONSTRAINT "a_ck" CHECK (x > 0);');
    expect(alasan).toHaveLength(1);
    expect(alasan[0]).toContain("a_ck");
  });

  it("menerima ADD CONSTRAINT yang didahului DROP CONSTRAINT IF EXISTS", () => {
    expect(
      alasanTidakIdempoten(
        'ALTER TABLE "a" DROP CONSTRAINT IF EXISTS "a_ck";\nALTER TABLE "a" ADD CONSTRAINT "a_ck" CHECK (x > 0);',
      ),
    ).toEqual([]);
  });

  it("menolak CREATE INDEX / TABLE / COLUMN tanpa IF NOT EXISTS", () => {
    expect(alasanTidakIdempoten('CREATE UNIQUE INDEX "i" ON "a"("b");')).toHaveLength(1);
    expect(alasanTidakIdempoten('CREATE TABLE "a" (id uuid);')).toHaveLength(1);
    expect(alasanTidakIdempoten('ALTER TABLE "a" ADD COLUMN "b" UUID;')).toHaveLength(1);
  });

  it("menerima versi ber-IF NOT EXISTS", () => {
    expect(alasanTidakIdempoten('CREATE UNIQUE INDEX IF NOT EXISTS "i" ON "a"("b");')).toEqual([]);
    expect(alasanTidakIdempoten('CREATE TABLE IF NOT EXISTS "a" (id uuid);')).toEqual([]);
    expect(alasanTidakIdempoten('ALTER TABLE "a" ADD COLUMN IF NOT EXISTS "b" UUID;')).toEqual([]);
  });

  it("menolak CREATE TYPE (enum tidak bisa dibuat ulang)", () => {
    expect(alasanTidakIdempoten(`CREATE TYPE "Peran" AS ENUM ('a');`)).toHaveLength(1);
  });

  it("mengabaikan isi KOMENTAR — frasa penjelas tidak boleh dianggap pernyataan", () => {
    expect(
      alasanTidakIdempoten('-- tiap ADD CONSTRAINT harus didahului DROP CONSTRAINT\n/* CREATE INDEX contoh */'),
    ).toEqual([]);
  });
});
