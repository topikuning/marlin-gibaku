-- AlterTable: keuangan per lokasi (input manual)
ALTER TABLE "locations" ADD COLUMN "invoiced_value" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "locations" ADD COLUMN "paid_value" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "locations" ADD COLUMN "spent_value" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "locations" ADD COLUMN "budget_cap" BIGINT NOT NULL DEFAULT 0;
