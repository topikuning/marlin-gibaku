-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "duration_days" INTEGER NOT NULL DEFAULT 150,
ALTER COLUMN "start_date" DROP NOT NULL,
ALTER COLUMN "end_date" DROP NOT NULL;

-- Backfill: masa pelaksanaan (hari) dari tanggal yang sudah ada (end - start).
UPDATE "contracts"
SET "duration_days" = GREATEST(1, ("end_date" - "start_date"))
WHERE "start_date" IS NOT NULL AND "end_date" IS NOT NULL;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "district" TEXT;
