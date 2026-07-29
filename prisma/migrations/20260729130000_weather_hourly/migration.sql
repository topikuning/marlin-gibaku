-- Cuaca laporan harian: kondisi PER JAM + cache pengamatan per lokasi/tanggal.
--
-- Blanko KKP meminta centang kondisi cuaca per jam (07.00–21.00), sementara
-- sistem hanya menyimpan SATU kategori untuk sehari penuh sehingga kelima belas
-- kolom jam tercentang seragam. Kolom `weather_hourly` menyimpan kondisi nyata
-- per jam; `weather` (satu nilai) tetap dipertahankan sebagai ringkasan yang
-- dipakai ekspor/AI/WhatsApp yang sudah ada.
--
-- `weather_source` menjaga aturan: isian MANUAL orang lapangan tidak boleh
-- ditimpa pengambilan otomatis.
--
-- IDEMPOTEN — Prisma menjalankan pernyataan satu per satu (bukan satu
-- transaksi); file ini aman dijalankan ulang setelah kegagalan separuh jalan.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WeatherSource') THEN
    CREATE TYPE "WeatherSource" AS ENUM ('otomatis', 'manual');
  END IF;
END
$$;

ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "weather_hourly" JSONB;
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "weather_source" "WeatherSource";
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "weather_fetched_at" TIMESTAMPTZ;

-- Laporan lama yang sudah punya isian cuaca: itu isian tangan orang lapangan.
UPDATE "daily_reports"
SET "weather_source" = 'manual'
WHERE "weather" IS NOT NULL AND "weather_source" IS NULL;

CREATE TABLE IF NOT EXISTS "weather_observations" (
  "id"          UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "observed_on" DATE NOT NULL,
  "provider"    TEXT NOT NULL,
  "lat"         DECIMAL(10,7) NOT NULL,
  "lng"         DECIMAL(10,7) NOT NULL,
  "hourly"      JSONB NOT NULL,
  "fetched_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "weather_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "weather_observations_location_id_observed_on_key"
  ON "weather_observations" ("location_id", "observed_on");

ALTER TABLE "weather_observations"
  DROP CONSTRAINT IF EXISTS "weather_observations_location_id_fkey";
ALTER TABLE "weather_observations"
  ADD CONSTRAINT "weather_observations_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
