-- Koreksi label: revisi RAB (& baseline kurva-S) yang terlanjur ke-cap 'adendum'
-- padahal kontraknya BELUM SPMK (start_date kosong / belum ada kontrak) diturunkan
-- ke 'hps_awal' / 'auto'. Adendum resmi hanya berlaku setelah kontrak jalan.
-- DECISIONS 118.

UPDATE "rab_revisions" rr
SET "source" = 'hps_awal'
WHERE rr."source" = 'adendum'
  AND NOT EXISTS (
    SELECT 1
    FROM "locations" l
    JOIN "packages" p ON p."id" = l."package_id"
    JOIN "contracts" c ON c."package_id" = p."id"
    WHERE l."id" = rr."location_id" AND c."start_date" IS NOT NULL
  );

UPDATE "baselines" b
SET "source" = 'auto'
WHERE b."source" = 'adendum'
  AND NOT EXISTS (
    SELECT 1
    FROM "locations" l
    JOIN "packages" p ON p."id" = l."package_id"
    JOIN "contracts" c ON c."package_id" = p."id"
    WHERE l."id" = b."location_id" AND c."start_date" IS NOT NULL
  );
