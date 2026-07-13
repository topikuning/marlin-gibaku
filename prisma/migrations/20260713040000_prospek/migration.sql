-- CreateEnum
CREATE TYPE "ProspekStage" AS ENUM ('identifikasi', 'undangan', 'penawaran', 'negosiasi', 'penetapan', 'jadi_kontrak', 'batal');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "hps_value" BIGINT;
ALTER TABLE "contracts" ADD COLUMN "prospek_id" UUID;

-- CreateTable
CREATE TABLE "prospek" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "name" TEXT NOT NULL,
    "package_number" TEXT,
    "hps_value" BIGINT NOT NULL DEFAULT 0,
    "stage" "ProspekStage" NOT NULL DEFAULT 'identifikasi',
    "province" TEXT,
    "contractor_name" TEXT,
    "note" TEXT,
    "contract_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospek_lokasi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prospek_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "village" TEXT NOT NULL,
    "regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "created_location_id" UUID,

    CONSTRAINT "prospek_lokasi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospek_org_id_stage_idx" ON "prospek"("org_id", "stage");
CREATE INDEX "prospek_lokasi_prospek_id_idx" ON "prospek_lokasi"("prospek_id");

-- AddForeignKey
ALTER TABLE "prospek_lokasi" ADD CONSTRAINT "prospek_lokasi_prospek_id_fkey" FOREIGN KEY ("prospek_id") REFERENCES "prospek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
