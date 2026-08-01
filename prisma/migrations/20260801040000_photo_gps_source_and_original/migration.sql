-- Asal koordinat cap foto + arsip berkas asli (DECISIONS 197).
--
-- Sebelum ini kolom exif_gps_lat/lng menyimpan koordinat APA PUN yang dicap —
-- termasuk titik lokasi proyek yang dipakai sebagai cadangan saat foto tidak
-- membawa GPS. Akibatnya foto ber-cadangan tetap terhitung "GPS ada" di galeri,
-- ikut dihitung sebagai foto ber-GPS di readiness/quality, dan tidak pernah
-- bisa melanggar rule radius (jaraknya nol dari titik proyek).
--
-- Idempoten (DECISIONS 167/176): enum berpenjaga pg_type, kolom & indeks pakai
-- IF NOT EXISTS, backfill hanya menyentuh baris yang masih 'none'.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PhotoGpsSource') THEN
    CREATE TYPE "PhotoGpsSource" AS ENUM ('exif', 'device', 'project', 'none');
  END IF;
END
$$;

ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "gps_source" "PhotoGpsSource" NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "original_key" TEXT,
  ADD COLUMN IF NOT EXISTS "original_bytes" INTEGER;

-- Backfill: koordinat yang PERSIS sama dengan titik lokasi proyeknya hanya bisa
-- berasal dari cadangan (peluang GPS asli identik sampai 7 desimal ~ nol).
UPDATE "photos" p
SET "gps_source" = 'project'
FROM "locations" l
WHERE p."location_id" = l."id"
  AND p."gps_source" = 'none'
  AND p."exif_gps_lat" IS NOT NULL
  AND l."gps_lat" IS NOT NULL
  AND p."exif_gps_lat" = l."gps_lat"
  AND p."exif_gps_lng" = l."gps_lng";

-- Sisanya yang punya koordinat = GPS asli (EXIF atau perangkat). Keduanya tidak
-- bisa dibedakan surut, jadi ditandai 'exif' — sama-sama GPS nyata.
UPDATE "photos"
SET "gps_source" = 'exif'
WHERE "exif_gps_lat" IS NOT NULL AND "gps_source" = 'none';

-- original_key SENGAJA dibiarkan NULL untuk foto lama: berkas aslinya memang
-- tidak pernah disimpan, jadi tidak ada yang bisa ditunjuk. Jangan diisi.
CREATE INDEX IF NOT EXISTS "photos_gps_source_idx" ON "photos" ("gps_source");
