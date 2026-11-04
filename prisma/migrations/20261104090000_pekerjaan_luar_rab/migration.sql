-- PEKERJAAN DI LUAR RAB (DECISIONS 738).
--
-- Pekerjaan yang sudah dikerjakan di lapangan tetapi itemnya belum ada di RAB
-- maupun di draft adendum dicatat pelaksana di laporan harian (uraian, satuan,
-- volume, foto wajib, tanpa harga). Catatan ini bukan angka resmi; ia bahan
-- CCO, lalu dipadankan Site Manager ke item draft adendum.
--
-- Status sengaja TIDAK disimpan (turunan dari dibatalkan_at & report_item_id),
-- jadi baris hasil padanan yang dihapus mengembalikan catatannya ke "menunggu"
-- lewat ON DELETE SET NULL.
--
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS "pekerjaan_luar_rab" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "uraian" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "volume" DECIMAL(15,3) NOT NULL,
    "catatan" TEXT,
    "report_item_id" UUID,
    "dipadankan_by_id" UUID,
    "dipadankan_at" TIMESTAMPTZ,
    "dibatalkan_at" TIMESTAMPTZ,
    "dibatalkan_by_id" UUID,
    "alasan_batal" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pekerjaan_luar_rab_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pekerjaan_luar_rab_location_id_dibatalkan_at_report_item_id_idx"
  ON "pekerjaan_luar_rab"("location_id", "dibatalkan_at", "report_item_id");
CREATE INDEX IF NOT EXISTS "pekerjaan_luar_rab_report_id_idx" ON "pekerjaan_luar_rab"("report_id");
CREATE INDEX IF NOT EXISTS "pekerjaan_luar_rab_report_item_id_idx" ON "pekerjaan_luar_rab"("report_item_id");

ALTER TABLE "pekerjaan_luar_rab" DROP CONSTRAINT IF EXISTS "pekerjaan_luar_rab_location_id_fkey";
ALTER TABLE "pekerjaan_luar_rab" ADD CONSTRAINT "pekerjaan_luar_rab_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pekerjaan_luar_rab" DROP CONSTRAINT IF EXISTS "pekerjaan_luar_rab_report_id_fkey";
ALTER TABLE "pekerjaan_luar_rab" ADD CONSTRAINT "pekerjaan_luar_rab_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pekerjaan_luar_rab" DROP CONSTRAINT IF EXISTS "pekerjaan_luar_rab_report_item_id_fkey";
ALTER TABLE "pekerjaan_luar_rab" ADD CONSTRAINT "pekerjaan_luar_rab_report_item_id_fkey"
  FOREIGN KEY ("report_item_id") REFERENCES "daily_report_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Volume catatan selalu positif; alasan wajib bila dibatalkan. Dijaga di DB,
-- bukan hanya di layanan: jalur tulis lain (skrip, impor) tidak bisa lolos.
ALTER TABLE "pekerjaan_luar_rab" DROP CONSTRAINT IF EXISTS "pekerjaan_luar_rab_volume_ck";
ALTER TABLE "pekerjaan_luar_rab" ADD CONSTRAINT "pekerjaan_luar_rab_volume_ck" CHECK ("volume" > 0);
ALTER TABLE "pekerjaan_luar_rab" DROP CONSTRAINT IF EXISTS "pekerjaan_luar_rab_batal_ck";
ALTER TABLE "pekerjaan_luar_rab" ADD CONSTRAINT "pekerjaan_luar_rab_batal_ck"
  CHECK ("dibatalkan_at" IS NULL OR (length(trim(coalesce("alasan_batal", ''))) > 0 AND "report_item_id" IS NULL));

-- Foto bukti catatan.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "luar_rab_id" UUID;
CREATE INDEX IF NOT EXISTS "photos_luar_rab_id_idx" ON "photos"("luar_rab_id");
ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_luar_rab_id_fkey";
ALTER TABLE "photos" ADD CONSTRAINT "photos_luar_rab_id_fkey"
  FOREIGN KEY ("luar_rab_id") REFERENCES "pekerjaan_luar_rab"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Sama dengan `photos_item_needs_report_ck`: foto catatan selalu milik laporannya.
ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_luar_rab_needs_report_ck";
ALTER TABLE "photos" ADD CONSTRAINT "photos_luar_rab_needs_report_ck"
  CHECK ("luar_rab_id" IS NULL OR "report_id" IS NOT NULL);
