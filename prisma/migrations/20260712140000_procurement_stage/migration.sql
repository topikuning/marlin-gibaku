-- CreateEnum
CREATE TYPE "ProcurementStage" AS ENUM ('belum_diundang', 'diundang', 'negosiasi', 'sppbj', 'kontrak', 'survey', 'pcm', 'spmk');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN "procurement_stage" "ProcurementStage" NOT NULL DEFAULT 'belum_diundang';
