-- Putaran kumulatif foto terhadap berkas ASLI (DECISIONS 424c).
-- Idempoten: aman dijalankan ulang pada basis yang sudah punya kolomnya.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "rotation_deg" INTEGER NOT NULL DEFAULT 0;
