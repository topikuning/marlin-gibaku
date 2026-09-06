-- Pengarsipan pencabutan lokasi (ketetapan user 2026-09-06).
--
-- Idempoten (DECISIONS 167): berkas ini harus bisa dijalankan ulang di basis
-- data yang sudah memilikinya tanpa gagal.
ALTER TABLE "location_scope_changes"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" UUID;

CREATE INDEX IF NOT EXISTS "location_scope_changes_archived_at_idx"
  ON "location_scope_changes" ("archived_at");
