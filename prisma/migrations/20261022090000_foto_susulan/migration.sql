-- Foto susulan di laporan yang sudah dikirim (DECISIONS 696).
-- Idempoten (DECISIONS 167): aman dijalankan ulang.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "added_after_submit_at" TIMESTAMPTZ;
