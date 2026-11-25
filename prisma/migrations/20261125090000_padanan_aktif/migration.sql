-- PEMASANGAN REALISASI SESUDAH AKTIVASI ADENDUM (DECISIONS 777)
--
-- Permintaan user 2026-11-25: "buat bisa dipasangkan sesudah aktivasi, menu
-- khusus. mitigasi semua resiko dan penanganannya".
--
-- Item yang sudah dilaporkan tetapi tidak dipasangkan saat adendum diaktifkan
-- (hilang dari RAB, atau volumenya dinolkan) kini bisa dipasangkan ke item RAB
-- aktif lewat USULAN yang baru berlaku sesudah dua persetujuan (Program
-- Director + AM/PM/SM, sama dengan aktivasi adendum, DECISIONS 234).
--
-- Baris laporan yang dipindah membawa penanda usulannya dan volume sebelum
-- dipasangkan, supaya Lepas mengembalikan keadaan persis seperti saat aktivasi.
--
-- Idempoten (DECISIONS 167).

CREATE TABLE IF NOT EXISTS "rab_padanan_aktif" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "location_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "lineage_lama" TEXT NOT NULL,
  "lineage_baru" TEXT NOT NULL,
  "jenis" TEXT NOT NULL,
  "alasan" TEXT NOT NULL,
  "ringkasan" JSONB NOT NULL,
  "diajukan_oleh_id" UUID NOT NULL,
  "diajukan_pada" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "berlaku_pada" TIMESTAMPTZ,
  "ditutup_pada" TIMESTAMPTZ,
  "ditutup_oleh_id" UUID,
  "alasan_tutup" TEXT,
  "dilepas_pada" TIMESTAMPTZ,
  "dilepas_oleh_id" UUID,
  "alasan_lepas" TEXT,
  CONSTRAINT "rab_padanan_aktif_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rab_padanan_aktif_location_id_lineage_lama_idx"
  ON "rab_padanan_aktif"("location_id", "lineage_lama");

ALTER TABLE "rab_padanan_aktif" DROP CONSTRAINT IF EXISTS "rab_padanan_aktif_location_id_fkey";
ALTER TABLE "rab_padanan_aktif"
  ADD CONSTRAINT "rab_padanan_aktif_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rab_padanan_aktif" DROP CONSTRAINT IF EXISTS "rab_padanan_aktif_revision_id_fkey";
ALTER TABLE "rab_padanan_aktif"
  ADD CONSTRAINT "rab_padanan_aktif_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rab_padanan_aktif" DROP CONSTRAINT IF EXISTS "rab_padanan_aktif_diajukan_oleh_id_fkey";
ALTER TABLE "rab_padanan_aktif"
  ADD CONSTRAINT "rab_padanan_aktif_diajukan_oleh_id_fkey"
  FOREIGN KEY ("diajukan_oleh_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "rab_padanan_aktif_setuju" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "padanan_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "UserRole" NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rab_padanan_aktif_setuju_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rab_padanan_aktif_setuju_padanan_id_user_id_key"
  ON "rab_padanan_aktif_setuju"("padanan_id", "user_id");

ALTER TABLE "rab_padanan_aktif_setuju" DROP CONSTRAINT IF EXISTS "rab_padanan_aktif_setuju_padanan_id_fkey";
ALTER TABLE "rab_padanan_aktif_setuju"
  ADD CONSTRAINT "rab_padanan_aktif_setuju_padanan_id_fkey"
  FOREIGN KEY ("padanan_id") REFERENCES "rab_padanan_aktif"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rab_padanan_aktif_setuju" DROP CONSTRAINT IF EXISTS "rab_padanan_aktif_setuju_user_id_fkey";
ALTER TABLE "rab_padanan_aktif_setuju"
  ADD CONSTRAINT "rab_padanan_aktif_setuju_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_report_items" ADD COLUMN IF NOT EXISTS "padanan_aktif_id" UUID;
ALTER TABLE "daily_report_items" ADD COLUMN IF NOT EXISTS "volume_sebelum_padanan" DECIMAL(15,3);

CREATE INDEX IF NOT EXISTS "daily_report_items_padanan_aktif_id_idx"
  ON "daily_report_items"("padanan_aktif_id");

ALTER TABLE "daily_report_items" DROP CONSTRAINT IF EXISTS "daily_report_items_padanan_aktif_id_fkey";
ALTER TABLE "daily_report_items"
  ADD CONSTRAINT "daily_report_items_padanan_aktif_id_fkey"
  FOREIGN KEY ("padanan_aktif_id") REFERENCES "rab_padanan_aktif"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
