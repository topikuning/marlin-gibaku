-- PAPARAN MINGGUAN KKP (DECISIONS 416).
--
-- Deck PDF 16:9 per paket per minggu kontrak memakai lifecycle AiRun/AiArtifact
-- yang sudah ada — yang ditambah hanya jenisnya dan kolom paket.
--
-- Idempoten: ADD VALUE / ADD COLUMN / DROP CONSTRAINT IF EXISTS.
ALTER TYPE "AiRunKind" ADD VALUE IF NOT EXISTS 'paparan';
ALTER TYPE "AiArtifactKind" ADD VALUE IF NOT EXISTS 'paparan';

-- Paket pemilik artefak paparan. Kolom nyata (bukan JSON path) supaya daftar
-- paparan per paket dicari lewat index, dan supaya scope organisasi bisa
-- disaring lewat relasi paket yang sah.
ALTER TABLE "ai_artifacts" ADD COLUMN IF NOT EXISTS "package_id" UUID;

ALTER TABLE "ai_artifacts" DROP CONSTRAINT IF EXISTS "ai_artifacts_package_id_fkey";
ALTER TABLE "ai_artifacts"
  ADD CONSTRAINT "ai_artifacts_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ai_artifacts_package_id_updated_at_idx"
  ON "ai_artifacts"("package_id", "updated_at");
