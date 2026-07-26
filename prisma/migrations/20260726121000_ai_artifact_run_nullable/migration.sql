-- AlterTable: artefak saran deterministik boleh tanpa run AI
ALTER TABLE "ai_artifacts" ALTER COLUMN "run_id" DROP NOT NULL;
