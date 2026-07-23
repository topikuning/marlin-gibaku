-- CreateEnum
CREATE TYPE "FieldActivityType" AS ENUM ('rapat_pcm', 'pengukuran_uitzet', 'mc0', 'sosialisasi', 'mobilisasi', 'dokumentasi_0', 'lainnya');

-- CreateEnum
CREATE TYPE "FieldActivityStatus" AS ENUM ('draft', 'final');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "activity_id" UUID;

-- CreateTable
CREATE TABLE "field_activities" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "activity_date" DATE NOT NULL,
    "type" "FieldActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "participants" TEXT,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "status" "FieldActivityStatus" NOT NULL DEFAULT 'draft',
    "created_by_id" UUID NOT NULL,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "field_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_activities_location_id_activity_date_idx" ON "field_activities"("location_id", "activity_date");

-- CreateIndex
CREATE INDEX "field_activities_location_id_status_idx" ON "field_activities"("location_id", "status");

-- CreateIndex
CREATE INDEX "photos_activity_id_idx" ON "photos"("activity_id");

-- AddForeignKey
ALTER TABLE "field_activities" ADD CONSTRAINT "field_activities_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "field_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
