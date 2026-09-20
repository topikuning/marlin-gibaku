-- GRUP WA PER KABUPATEN DI DALAM PAKET (DECISIONS 596)
--
-- PPK membuat grup WhatsApp per KABUPATEN, sementara `packages.wa_group_id`
-- hanya bisa menyatakan satu grup untuk seluruh paket. Tabel ini menampung
-- grup yang lebih sempit itu.
--
-- `package_id` WAJIB, dan `locations` menunjuk ke sini lewat FK KOMPOSIT
-- (wa_group_ref_id, package_id). Dengan begitu basis data sendiri yang menolak
-- lokasi paket A memakai grup paket B — keputusan user 2026-09-20: grup
-- kabupaten tetap kabupaten DI DALAM paket itu. Aturan sepenting ini tidak
-- boleh bergantung pada kode yang ingat memeriksanya.
--
-- Idempoten (DECISIONS 167): migrasi dijalankan pernyataan per pernyataan,
-- bukan dalam satu transaksi, jadi setiap langkah harus aman diulang.

CREATE TABLE IF NOT EXISTS "wa_groups" (
  "id"            UUID         NOT NULL,
  "org_id"        UUID         NOT NULL,
  "package_id"    UUID         NOT NULL,
  "wa_group_id"   TEXT         NOT NULL,
  "wa_group_name" TEXT,
  "regency"       TEXT,
  "province"      TEXT,
  "created_by_id" UUID,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_groups_pkey" PRIMARY KEY ("id")
);

-- Satu grup WhatsApp nyata = satu baris. Pesan masuk dipetakan dengan kesamaan
-- persis atas bentuk kanonik, bukan pencocokan longgar (DECISIONS 370).
CREATE UNIQUE INDEX IF NOT EXISTS "wa_groups_wa_group_id_key" ON "wa_groups" ("wa_group_id");

-- Sasaran FK komposit dari `locations`.
CREATE UNIQUE INDEX IF NOT EXISTS "wa_groups_id_package_id_key" ON "wa_groups" ("id", "package_id");

CREATE INDEX IF NOT EXISTS "wa_groups_package_id_idx" ON "wa_groups" ("package_id");

ALTER TABLE "wa_groups" DROP CONSTRAINT IF EXISTS "wa_groups_package_id_fkey";
ALTER TABLE "wa_groups"
  ADD CONSTRAINT "wa_groups_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wa_group_ref_id" UUID;

CREATE INDEX IF NOT EXISTS "locations_wa_group_ref_id_idx" ON "locations" ("wa_group_ref_id");

-- FK KOMPOSIT — inti penegakan "grup tidak pernah melintasi paket".
-- ON DELETE RESTRICT: grup yang masih dipakai lokasi tidak bisa dihapus diam-
-- diam; lepaskan anggotanya dulu, supaya tidak ada lokasi yang kehilangan
-- tujuan kiriman tanpa ada yang tahu.
ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_wa_group_ref_id_package_id_fkey";
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_wa_group_ref_id_package_id_fkey"
  FOREIGN KEY ("wa_group_ref_id", "package_id") REFERENCES "wa_groups" ("id", "package_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
