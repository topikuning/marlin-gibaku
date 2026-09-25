-- DECISIONS 617: foto yang sudah membawa tag lokasi/tanggal dari aplikasi kamera.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "existing_tag_location" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "existing_tag_time" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "existing_tag_evidence" TEXT;
