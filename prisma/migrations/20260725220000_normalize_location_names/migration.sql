-- Seragamkan nama lokasi: buang prefix "KNMP " (redundan — seluruh sistem = proyek
-- KNMP). Slug TIDAK diubah (identitas URL stabil). DECISIONS 117.
UPDATE "locations"
SET "name" = regexp_replace("name", '^KNMP\s+', '')
WHERE "name" ~ '^KNMP\s+';
