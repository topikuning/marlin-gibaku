-- PERUBAHAN LINGKUP LOKASI LEWAT ADENDUM (kebutuhan user 2026-09-05).
--
-- Lokasi yang dicabut TIDAK dihapus: laporan, foto, dan realisasinya tetap.
-- Yang berubah hanya keikutsertaannya dalam angka paket sejak tanggal berlaku
-- CCO, dan itu DITURUNKAN dari baris di bawah — bukan disalin ke kolom
-- `locations`, supaya tidak ada dua sumber kebenaran.
--
-- Idempoten (DECISIONS 167): Prisma menjalankan pernyataan satu per satu, jadi
-- migrasi yang gagal di tengah harus aman diulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocationScopeKind') THEN
    CREATE TYPE "LocationScopeKind" AS ENUM ('tambah', 'cabut');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocationScopeStatus') THEN
    CREATE TYPE "LocationScopeStatus" AS ENUM ('draft', 'aktif', 'dibatalkan');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "location_scope_changes" (
  "id"             UUID                  NOT NULL,
  "location_id"    UUID                  NOT NULL,
  "amendment_id"   UUID                  NOT NULL,
  "kind"           "LocationScopeKind"   NOT NULL,
  "effective_date" DATE                  NOT NULL,
  "status"         "LocationScopeStatus" NOT NULL DEFAULT 'draft',
  "reason"         TEXT                  NOT NULL,
  "created_by_id"  UUID,
  "created_at"     TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at"     TIMESTAMPTZ,
  CONSTRAINT "location_scope_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "location_scope_approvals" (
  "id"          UUID        NOT NULL,
  "change_id"   UUID        NOT NULL,
  "user_id"     UUID        NOT NULL,
  "role"        "UserRole"  NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_scope_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "location_scope_changes_location_id_status_idx"
  ON "location_scope_changes" ("location_id", "status");
CREATE INDEX IF NOT EXISTS "location_scope_changes_amendment_id_idx"
  ON "location_scope_changes" ("amendment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "location_scope_approvals_change_id_user_id_key"
  ON "location_scope_approvals" ("change_id", "user_id");

ALTER TABLE "location_scope_changes"
  DROP CONSTRAINT IF EXISTS "location_scope_changes_location_id_fkey";
ALTER TABLE "location_scope_changes"
  ADD CONSTRAINT "location_scope_changes_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "location_scope_changes"
  DROP CONSTRAINT IF EXISTS "location_scope_changes_amendment_id_fkey";
ALTER TABLE "location_scope_changes"
  ADD CONSTRAINT "location_scope_changes_amendment_id_fkey"
  FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "location_scope_approvals"
  DROP CONSTRAINT IF EXISTS "location_scope_approvals_change_id_fkey";
ALTER TABLE "location_scope_approvals"
  ADD CONSTRAINT "location_scope_approvals_change_id_fkey"
  FOREIGN KEY ("change_id") REFERENCES "location_scope_changes" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "location_scope_approvals"
  DROP CONSTRAINT IF EXISTS "location_scope_approvals_user_id_fkey";
ALTER TABLE "location_scope_approvals"
  ADD CONSTRAINT "location_scope_approvals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
