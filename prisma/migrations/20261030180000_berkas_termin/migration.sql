-- Berkas termin (DECISIONS 720): butir daftar periksa penagihan yang dipenuhi
-- sebuah dokumen, dan termin-nya. Idempoten (DECISIONS 167).

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "termin_ke" INTEGER;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "butir_termin" TEXT;
CREATE INDEX IF NOT EXISTS "documents_package_id_butir_termin_idx" ON "documents"("package_id", "butir_termin");
