-- Antrean unggah OTOMATIS laporan ke folder Google Drive KKP (DECISIONS 313).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

CREATE TABLE IF NOT EXISTS "gdrive_jobs" (
    "id"              UUID        NOT NULL,
    "kind"            TEXT        NOT NULL,
    "ref_key"         TEXT        NOT NULL,
    "periode"         TEXT        NOT NULL,
    "package_id"      UUID        NOT NULL,
    "location_id"     UUID        NOT NULL,
    "status"          TEXT        NOT NULL DEFAULT 'menunggu',
    "attempts"        INTEGER     NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at"      TIMESTAMPTZ,
    "finished_at"     TIMESTAMPTZ,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gdrive_jobs_pkey" PRIMARY KEY ("id")
);

-- Pengaman "satu keluaran diantre sekali". Pindai berjalan tiap putaran dan
-- aman diulang justru karena batasan ini, bukan karena penjadwalnya rapi.
CREATE UNIQUE INDEX IF NOT EXISTS "gdrive_jobs_kind_ref_key_key"
    ON "gdrive_jobs" ("kind", "ref_key");

-- Jalur baca panas: "pekerjaan menunggu yang sudah boleh dicoba lagi".
CREATE INDEX IF NOT EXISTS "gdrive_jobs_status_next_attempt_at_idx"
    ON "gdrive_jobs" ("status", "next_attempt_at");

ALTER TABLE "gdrive_jobs" DROP CONSTRAINT IF EXISTS "gdrive_jobs_package_id_fkey";
ALTER TABLE "gdrive_jobs" ADD CONSTRAINT "gdrive_jobs_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gdrive_jobs" DROP CONSTRAINT IF EXISTS "gdrive_jobs_location_id_fkey";
ALTER TABLE "gdrive_jobs" ADD CONSTRAINT "gdrive_jobs_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
