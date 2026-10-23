-- Catatan putaran sinkron Kawal yang berhasil dengan penyesuaian (DECISIONS 700).
ALTER TABLE "kawal_sync_runs" ADD COLUMN IF NOT EXISTS "catatan" TEXT;
