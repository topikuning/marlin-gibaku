-- KATALOG LOKASI DILENGKAPI DARI MASTER DATA KNMP (kebutuhan user 2026-09-06).
--
-- Yang diambil hanya yang DIPAKAI MARLIN; data perusahaan (nama, skala,
-- kedudukan, kontak, sponsor, calon penyedia) sengaja TIDAK ikut — ketetapan
-- user hari yang sama. Semua kolom baru opsional: katalog lama tetap sah.
--
-- Idempoten (DECISIONS 167).

ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "source_code"       TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "name"              TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "region"            TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "cluster"           TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "pleno_result"      TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "status_code"       TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "status_label"      TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "status_reason"     TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "coordinate_status" TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "source_batch"      TEXT;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "land_area_ha"      DECIMAL(10,4);
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "fishermen_count"   INTEGER;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "boats_no_engine"   INTEGER;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "boats_engine"      INTEGER;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "boats_total"       INTEGER;
ALTER TABLE "master_locations" ADD COLUMN IF NOT EXISTS "ee_value"          BIGINT;

CREATE INDEX IF NOT EXISTS "master_locations_org_id_source_code_idx"
  ON "master_locations" ("org_id", "source_code");
