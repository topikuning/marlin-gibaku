-- AlterTable
ALTER TABLE "daily_report_items" ADD COLUMN "worker_count" INTEGER;
ALTER TABLE "daily_report_items" ADD COLUMN "constraint_note" TEXT;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN "deviation_cause" TEXT;
ALTER TABLE "locations" ADD COLUMN "recovery_plan" TEXT;
