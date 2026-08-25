import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — skrip preDeploy sengaja .mjs polos (dijalankan di image runner).
import { alasanTidakIdempoten, namaMigrasiGagal } from "../../scripts/migrate-deploy.mjs";

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

  it("menolak CREATE TYPE telanjang (PostgreSQL tak punya IF NOT EXISTS untuk tipe)", () => {
    const alasan = alasanTidakIdempoten(`CREATE TYPE "Warna" AS ENUM ('merah', 'putih');`);
    expect(alasan).toHaveLength(1);
    expect(alasan[0]).toContain("Warna");
  });

  it("menerima CREATE TYPE di dalam blok DO berpenjaga pg_type (aman diulang)", () => {
    expect(
      alasanTidakIdempoten(
        `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Warna') THEN\n` +
          `    CREATE TYPE "Warna" AS ENUM ('merah', 'putih');\n  END IF;\nEND\n$$;`,
      ),
    ).toEqual([]);
  });

  it("blok DO TANPA penjaga pg_type tetap ditolak", () => {
    expect(
      alasanTidakIdempoten(`DO $$\nBEGIN\n  CREATE TYPE "Warna" AS ENUM ('merah');\nEND\n$$;`),
    ).toHaveLength(1);
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

  it("mengabaikan isi KOMENTAR – frasa penjelas tidak boleh dianggap pernyataan", () => {
    expect(
      alasanTidakIdempoten('-- tiap ADD CONSTRAINT harus didahului DROP CONSTRAINT\n/* CREATE INDEX contoh */'),
    ).toEqual([]);
  });
});

describe("membaca nama migrasi yang GAGAL dari keluaran Prisma", () => {
  /*
   * Bug laten yang baru ketahuan saat dev Railway benar-benar macet
   * (2026-08-19, DECISIONS 373): pemulihan otomatis mencari nama migrasi gagal
   * lewat `prisma migrate status` — dan pada Prisma 7 perintah itu SAMA SEKALI
   * tidak menyebutnya, hanya mendaftar yang belum diterapkan. Jadi pemulihannya
   * selalu berhenti di "nama migrasinya tidak terbaca", dan deploy tetap mentok
   * persis pada keadaan yang seharusnya ia selamatkan.
   *
   * Teks di bawah adalah keluaran SUNGGUHAN, disalin apa adanya. Uji yang
   * memakai teks karangan tidak akan pernah menangkap kegagalan ini — karena
   * yang salah bukan pola regex-nya, melainkan sumber teks yang dibaca.
   */
  const KELUARAN_DEPLOY_P3009 = `60 migrations found in prisma/migrations
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The \`20260819120000_wa_group_unik\` migration started at 2026-08-19 07:40:19.101506 UTC failed`;

  const KELUARAN_DEPLOY_P3018 = `Error: P3018
A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Migration name: 20260819120000_wa_group_unik
Database error code: P0001`;

  const KELUARAN_STATUS_PRISMA7 = `60 migrations found in prisma/migrations
Following migration have not yet been applied:
20260819140000_wa_reply_job

To apply migrations in production run prisma migrate deploy.`;

  it("P3009 dari keluaran deploy terbaca", () => {
    expect(namaMigrasiGagal(KELUARAN_DEPLOY_P3009)).toEqual(["20260819120000_wa_group_unik"]);
  });

  it("P3018 (baris 'Migration name:') juga terbaca", () => {
    expect(namaMigrasiGagal(KELUARAN_DEPLOY_P3018)).toEqual(["20260819120000_wa_group_unik"]);
  });

  it("`migrate status` Prisma 7 memang TIDAK memuat migrasi gagal", () => {
    /*
     * Ini bukan uji terhadap kode kita, melainkan terhadap ASUMSI yang dulu
     * dipegang diam-diam. Kalau suatu saat Prisma mulai menyebutkannya, uji ini
     * merah — dan itu kabar baik yang layak diketahui, bukan kegagalan.
     */
    expect(namaMigrasiGagal(KELUARAN_STATUS_PRISMA7)).toEqual([]);
  });

  it("keluaran sukses tidak menghasilkan nama apa pun", () => {
    expect(namaMigrasiGagal("All migrations have been successfully applied.")).toEqual([]);
  });

  it("nama yang sama dari dua baris tidak diduakalikan", () => {
    expect(namaMigrasiGagal(`${KELUARAN_DEPLOY_P3009}\n${KELUARAN_DEPLOY_P3018}`)).toEqual([
      "20260819120000_wa_group_unik",
    ]);
  });
});
