-- Harga Satuan Dasar per lokasi (DECISIONS 327).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

CREATE TABLE IF NOT EXISTS "harga_satuan_dasar" (
    "id"            UUID        NOT NULL,
    "location_id"   UUID        NOT NULL,
    "kategori"      TEXT        NOT NULL,
    "nama"          TEXT        NOT NULL,
    "satuan"        TEXT        NOT NULL,
    "harga"         BIGINT      NOT NULL,
    "sumber"        TEXT,
    "catatan"       TEXT,
    "updated_by_id" UUID,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harga_satuan_dasar_pkey" PRIMARY KEY ("id")
);

-- Kunci alaminya sama persis dengan kunci pengelompokan kebutuhan di
-- rapl-calc.ts: kategori + nama + satuan. Harga yang tidak bisa dijodohkan
-- dengan barisnya sendiri tidak ada gunanya.
CREATE UNIQUE INDEX IF NOT EXISTS "harga_satuan_dasar_lokasi_sumberdaya_key"
    ON "harga_satuan_dasar" ("location_id", "kategori", "nama", "satuan");
CREATE INDEX IF NOT EXISTS "harga_satuan_dasar_location_id_idx"
    ON "harga_satuan_dasar" ("location_id");
-- Jalur rekomendasi: "harga sumber daya ini di lokasi lain berapa?"
CREATE INDEX IF NOT EXISTS "harga_satuan_dasar_sumberdaya_idx"
    ON "harga_satuan_dasar" ("kategori", "nama", "satuan");

ALTER TABLE "harga_satuan_dasar" DROP CONSTRAINT IF EXISTS "harga_satuan_dasar_location_id_fkey";
ALTER TABLE "harga_satuan_dasar" ADD CONSTRAINT "harga_satuan_dasar_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "harga_satuan_dasar" DROP CONSTRAINT IF EXISTS "harga_satuan_dasar_updated_by_id_fkey";
ALTER TABLE "harga_satuan_dasar" ADD CONSTRAINT "harga_satuan_dasar_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
