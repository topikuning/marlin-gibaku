-- Berkas surat yang diunggah langsung ke register (DECISIONS 434). Idempoten.
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "file_r2_key" TEXT;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "file_name" TEXT;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "file_mime" TEXT;
