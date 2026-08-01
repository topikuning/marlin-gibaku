-- Perbaikan cap foto + pengelolaan arsip berkas asli (DECISIONS 198).
--
-- Cap dibakar ke gambar dan versi lamanya dibuang saat diperbaiki, jadi baris
-- photo_stamp_revisions adalah SATU-SATUNYA catatan apa yang dulu tertulis di
-- foto — karena itu append-only lewat trigger, sama seperti audit_logs.
--
-- Idempoten (DECISIONS 167/176): nilai enum & kolom pakai IF NOT EXISTS,
-- trigger di-DROP dulu, tabel CREATE TABLE IF NOT EXISTS.

-- ALTER TYPE ... ADD VALUE IF NOT EXISTS aman dijalankan ulang.
ALTER TYPE "PhotoGpsSource" ADD VALUE IF NOT EXISTS 'manual';

ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "stamp_photo_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stamp_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "original_purged_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "original_purged_by_id" UUID;

CREATE INDEX IF NOT EXISTS "photos_stamp_photo_id_idx" ON "photos" ("stamp_photo_id");

CREATE TABLE IF NOT EXISTS "photo_stamp_revisions" (
  "id" UUID NOT NULL,
  "photo_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "manual_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "changed_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "photo_stamp_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "photo_stamp_revisions_photo_id_revision_key"
  ON "photo_stamp_revisions" ("photo_id", "revision");
CREATE INDEX IF NOT EXISTS "photo_stamp_revisions_photo_id_idx"
  ON "photo_stamp_revisions" ("photo_id");

ALTER TABLE "photo_stamp_revisions"
  DROP CONSTRAINT IF EXISTS "photo_stamp_revisions_photo_id_fkey";
ALTER TABLE "photo_stamp_revisions"
  ADD CONSTRAINT "photo_stamp_revisions_photo_id_fkey"
  FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: koreksi = INSERT revisi baru, bukan menimpa yang lama.
DROP TRIGGER IF EXISTS photo_stamp_revisions_append_only ON "photo_stamp_revisions";
CREATE TRIGGER photo_stamp_revisions_append_only
  BEFORE UPDATE OR DELETE ON "photo_stamp_revisions"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();
