-- DATA-01 + STORE-01 (audit menyeluruh 2026-07-28)
--
-- Menegakkan invariant LOKAL di database, bukan hanya di server action:
-- bug, script sekali-jalan, migrasi, atau jalur action yang terlewat tetap
-- tidak boleh menyimpan state yang mustahil.
--
-- Semua ADD CONSTRAINT di bawah divalidasi terhadap data yang ADA. Bila ada
-- baris pelanggar, migrasi GAGAL dengan menyebut constraint-nya — itu memang
-- sinyal yang diinginkan: datanya diperbaiki dulu, jangan diloloskan.

-- ── STORE-01: scope dedup foto = per LOKASI, bukan global ────────────────────
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "location_id" UUID;

-- Backfill: lokasi diturunkan dari parent (laporan harian ATAU kegiatan lapangan).
UPDATE "photos" p
SET "location_id" = r."location_id"
FROM "daily_reports" r
WHERE p."report_id" = r."id" AND p."location_id" IS NULL;

UPDATE "photos" p
SET "location_id" = a."location_id"
FROM "field_activities" a
WHERE p."activity_id" = a."id" AND p."location_id" IS NULL;

ALTER TABLE "photos"
  ADD CONSTRAINT "photos_location_id_fkey" FOREIGN KEY ("location_id")
  REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "photos_location_id_idx" ON "photos"("location_id");

-- Unique sha256 GLOBAL ditukar dengan unique (lokasi, sha256): foto identik yang
-- sah di dua lokasi tidak lagi saling menolak.
DROP INDEX IF EXISTS "photos_sha256_key";
CREATE UNIQUE INDEX "photos_location_id_sha256_key" ON "photos"("location_id", "sha256");

-- Parent foto: TEPAT SATU dari laporan harian / kegiatan lapangan; item laporan
-- hanya boleh terisi bila laporannya terisi.
ALTER TABLE "photos" ADD CONSTRAINT "photos_parent_xor_ck" CHECK (
  (("report_id" IS NOT NULL)::int + ("activity_id" IS NOT NULL)::int) = 1
);
ALTER TABLE "photos" ADD CONSTRAINT "photos_item_needs_report_ck" CHECK (
  "report_item_id" IS NULL OR "report_id" IS NOT NULL
);
ALTER TABLE "photos" ADD CONSTRAINT "photos_bytes_positive_ck" CHECK ("bytes" > 0);

-- ── Koordinat dalam rentang bumi ─────────────────────────────────────────────
ALTER TABLE "locations" ADD CONSTRAINT "locations_gps_range_ck" CHECK (
  ("gps_lat" IS NULL OR ("gps_lat" >= -90 AND "gps_lat" <= 90)) AND
  ("gps_lng" IS NULL OR ("gps_lng" >= -180 AND "gps_lng" <= 180))
);
ALTER TABLE "master_locations" ADD CONSTRAINT "master_locations_gps_range_ck" CHECK (
  ("gps_lat" IS NULL OR ("gps_lat" >= -90 AND "gps_lat" <= 90)) AND
  ("gps_lng" IS NULL OR ("gps_lng" >= -180 AND "gps_lng" <= 180))
);
ALTER TABLE "photos" ADD CONSTRAINT "photos_exif_gps_range_ck" CHECK (
  ("exif_gps_lat" IS NULL OR ("exif_gps_lat" >= -90 AND "exif_gps_lat" <= 90)) AND
  ("exif_gps_lng" IS NULL OR ("exif_gps_lng" >= -180 AND "exif_gps_lng" <= 180))
);

-- ── Kontrak: nilai, persentase, durasi, rentang tanggal ──────────────────────
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_nonneg_ck" CHECK ("contract_value" >= 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_duration_positive_ck" CHECK ("duration_days" > 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_percent_range_ck" CHECK (
  "ppn_percent" >= 0 AND "ppn_percent" <= 100 AND
  ("advance_percent" IS NULL OR ("advance_percent" >= 0 AND "advance_percent" <= 100)) AND
  ("retention_percent" IS NULL OR ("retention_percent" >= 0 AND "retention_percent" <= 100))
);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_date_order_ck" CHECK (
  "start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date"
);

-- ── RAB & realisasi: volume/harga/nilai tidak negatif ────────────────────────
ALTER TABLE "rab_nodes" ADD CONSTRAINT "rab_nodes_amounts_nonneg_ck" CHECK (
  "amount" >= 0 AND
  ("volume" IS NULL OR "volume" >= 0) AND
  ("unit_price" IS NULL OR "unit_price" >= 0)
);
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_nonneg_ck" CHECK (
  "volume_done" >= 0 AND "value_done" >= 0
);

-- ── Keuangan: nilai non-negatif + retensi tidak melebihi nilai termin ────────
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_amount_nonneg_ck" CHECK ("amount" >= 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_nonneg_ck" CHECK ("amount" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_nonneg_ck" CHECK ("amount" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_date_order_ck" CHECK (
  "due_date" IS NULL OR "due_date" >= "invoice_date"
);
ALTER TABLE "payments_out" ADD CONSTRAINT "payments_out_amount_nonneg_ck" CHECK ("amount" >= 0);
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_amount_nonneg_ck" CHECK ("amount" >= 0);
ALTER TABLE "owner_billings" ADD CONSTRAINT "owner_billings_amount_nonneg_ck" CHECK (
  "amount" >= 0 AND "retention_held" >= 0 AND "retention_held" <= "amount"
);
