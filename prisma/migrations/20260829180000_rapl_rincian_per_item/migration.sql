-- RAPL memecah RAB per ITEM; AHSP jadi pembantu, bukan gerbang (RAPL-08,
-- DECISIONS 473). Idempoten: DECISIONS 167.

CREATE TABLE IF NOT EXISTS "rapl_rincian" (
  "id"               UUID        NOT NULL,
  "location_id"      UUID        NOT NULL,
  "lineage_key"      TEXT        NOT NULL,
  "faktor_konversi"  DECIMAL(18,6),
  "catatan_konversi" TEXT,
  "harga_borongan"   BIGINT,
  "catatan_borongan" TEXT,
  "updated_by_id"    UUID,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rapl_rincian_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "rapl_komponen_tambahan" (
  "id"         UUID          NOT NULL,
  "rincian_id" UUID          NOT NULL,
  "kategori"   TEXT          NOT NULL,
  "nama"       TEXT          NOT NULL,
  "satuan"     TEXT          NOT NULL,
  "koefisien"  DECIMAL(18,6) NOT NULL,
  "catatan"    TEXT,
  CONSTRAINT "rapl_komponen_tambahan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rapl_rincian_location_id_lineage_key_key"
  ON "rapl_rincian" ("location_id", "lineage_key");
CREATE INDEX IF NOT EXISTS "rapl_rincian_location_id_idx"
  ON "rapl_rincian" ("location_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rapl_komponen_tambahan_rincian_id_kategori_nama_satuan_key"
  ON "rapl_komponen_tambahan" ("rincian_id", "kategori", "nama", "satuan");
CREATE INDEX IF NOT EXISTS "rapl_komponen_tambahan_rincian_id_idx"
  ON "rapl_komponen_tambahan" ("rincian_id");

ALTER TABLE "rapl_rincian" DROP CONSTRAINT IF EXISTS "rapl_rincian_location_id_fkey";
ALTER TABLE "rapl_rincian"
  ADD CONSTRAINT "rapl_rincian_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rapl_rincian" DROP CONSTRAINT IF EXISTS "rapl_rincian_updated_by_id_fkey";
ALTER TABLE "rapl_rincian"
  ADD CONSTRAINT "rapl_rincian_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rapl_komponen_tambahan" DROP CONSTRAINT IF EXISTS "rapl_komponen_tambahan_rincian_id_fkey";
ALTER TABLE "rapl_komponen_tambahan"
  ADD CONSTRAINT "rapl_komponen_tambahan_rincian_id_fkey"
  FOREIGN KEY ("rincian_id") REFERENCES "rapl_rincian" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Faktor konversi tanpa alasan adalah tebakan yang menyamar jadi data
-- (DECISIONS 203 diterapkan ke jalur RAPL). Dijaga di DB, bukan hanya di form.
ALTER TABLE "rapl_rincian" DROP CONSTRAINT IF EXISTS "rapl_rincian_konversi_berkatatan";
ALTER TABLE "rapl_rincian"
  ADD CONSTRAINT "rapl_rincian_konversi_berkatatan"
  CHECK (
    "faktor_konversi" IS NULL
    OR ("faktor_konversi" > 0 AND "catatan_konversi" IS NOT NULL AND length(btrim("catatan_konversi")) > 0)
  );

-- Borongan nol berarti "belum berharga", bukan gratis — aturan yang sama
-- dengan HSD (DECISIONS 441).
ALTER TABLE "rapl_rincian" DROP CONSTRAINT IF EXISTS "rapl_rincian_borongan_positif";
ALTER TABLE "rapl_rincian"
  ADD CONSTRAINT "rapl_rincian_borongan_positif"
  CHECK ("harga_borongan" IS NULL OR "harga_borongan" > 0);

ALTER TABLE "rapl_komponen_tambahan" DROP CONSTRAINT IF EXISTS "rapl_komponen_tambahan_koefisien_positif";
ALTER TABLE "rapl_komponen_tambahan"
  ADD CONSTRAINT "rapl_komponen_tambahan_koefisien_positif"
  CHECK ("koefisien" > 0);
