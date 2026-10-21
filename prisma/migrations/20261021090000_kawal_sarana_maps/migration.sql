-- Pasangan sarana Kawal ↔ kelompok RAB MARLIN per lokasi (DECISIONS 694).
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_sarana_maps" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kawal_item_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "lineage_key" TEXT,
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kawal_sarana_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "kawal_sarana_maps_location_id_kawal_item_id_key" ON "kawal_sarana_maps"("location_id", "kawal_item_id");

-- AddForeignKey
ALTER TABLE "kawal_sarana_maps" DROP CONSTRAINT IF EXISTS "kawal_sarana_maps_location_id_fkey";
ALTER TABLE "kawal_sarana_maps" ADD CONSTRAINT "kawal_sarana_maps_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `tidak_ada` satu-satunya status tanpa kelompok.
ALTER TABLE "kawal_sarana_maps" DROP CONSTRAINT IF EXISTS "kawal_sarana_maps_status_check";
ALTER TABLE "kawal_sarana_maps" ADD CONSTRAINT "kawal_sarana_maps_status_check"
  CHECK ("status" IN ('dikonfirmasi', 'tidak_ada'));
ALTER TABLE "kawal_sarana_maps" DROP CONSTRAINT IF EXISTS "kawal_sarana_maps_kelompok_check";
ALTER TABLE "kawal_sarana_maps" ADD CONSTRAINT "kawal_sarana_maps_kelompok_check"
  CHECK (("status" = 'tidak_ada') = ("lineage_key" IS NULL));
