-- Bacaan satelit mentah per lokasi per jam blanko (DECISIONS 655).
CREATE TABLE IF NOT EXISTS "cuaca_satelit_jam" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "tanggal" DATE NOT NULL,
    "jam" SMALLINT NOT NULL,
    "awan_persen" SMALLINT,
    "awan_diambil" TIMESTAMPTZ,
    "hujan_mm" DOUBLE PRECISION,
    "hujan_diambil" TIMESTAMPTZ,

    CONSTRAINT "cuaca_satelit_jam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cuaca_satelit_jam_location_id_tanggal_jam_key" ON "cuaca_satelit_jam"("location_id", "tanggal", "jam");

ALTER TABLE "cuaca_satelit_jam" DROP CONSTRAINT IF EXISTS "cuaca_satelit_jam_location_id_fkey";
ALTER TABLE "cuaca_satelit_jam" ADD CONSTRAINT "cuaca_satelit_jam_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
