-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "is_bypass" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "master_locations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "province" TEXT NOT NULL,
    "regency" TEXT NOT NULL,
    "district" TEXT,
    "village" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "candidate_vendor" TEXT,
    "assigned_location_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_locations_assigned_location_id_key" ON "master_locations"("assigned_location_id");

-- CreateIndex
CREATE INDEX "master_locations_org_id_idx" ON "master_locations"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_locations_org_id_province_regency_district_village_key" ON "master_locations"("org_id", "province", "regency", "district", "village");

-- AddForeignKey
ALTER TABLE "master_locations" ADD CONSTRAINT "master_locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_locations" ADD CONSTRAINT "master_locations_assigned_location_id_fkey" FOREIGN KEY ("assigned_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
