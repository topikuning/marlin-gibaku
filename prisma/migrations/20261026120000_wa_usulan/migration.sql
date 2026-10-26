-- Usulan dari WhatsApp (DECISIONS 707): volume & foto pekerjaan dari WA
-- ditampung dulu, baru masuk laporan harian setelah dimasukkan orang.
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaUsulanStatus') THEN
    CREATE TYPE "WaUsulanStatus" AS ENUM ('menunggu', 'dimasukkan', 'dibuang');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wa_usulan" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "nama_pekerjaan" TEXT NOT NULL,
    "satuan" TEXT,
    "volume" DECIMAL(15,3),
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WaUsulanStatus" NOT NULL DEFAULT 'menunggu',
    "kunci_menunggu" TEXT,
    "diusulkan_oleh_id" UUID NOT NULL,
    "diputus_oleh_id" UUID,
    "diputus_at" TIMESTAMPTZ,
    "report_item_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "wa_usulan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_usulan_kunci_menunggu_key" ON "wa_usulan"("kunci_menunggu");
CREATE INDEX IF NOT EXISTS "wa_usulan_location_id_report_date_status_idx" ON "wa_usulan"("location_id", "report_date", "status");
CREATE INDEX IF NOT EXISTS "wa_usulan_status_idx" ON "wa_usulan"("status");

ALTER TABLE "wa_usulan" DROP CONSTRAINT IF EXISTS "wa_usulan_location_id_fkey";
ALTER TABLE "wa_usulan" ADD CONSTRAINT "wa_usulan_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_usulan" DROP CONSTRAINT IF EXISTS "wa_usulan_diusulkan_oleh_id_fkey";
ALTER TABLE "wa_usulan" ADD CONSTRAINT "wa_usulan_diusulkan_oleh_id_fkey"
  FOREIGN KEY ("diusulkan_oleh_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_usulan" DROP CONSTRAINT IF EXISTS "wa_usulan_diputus_oleh_id_fkey";
ALTER TABLE "wa_usulan" ADD CONSTRAINT "wa_usulan_diputus_oleh_id_fkey"
  FOREIGN KEY ("diputus_oleh_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Penanda foto yang dikirim lewat WhatsApp.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "wa_message_id" TEXT;

-- Sesi lapor: foto tidak lagi "menunggu ditempel" – ikut usulan.
ALTER TABLE "wa_lapor_sesi" DROP COLUMN IF EXISTS "foto_menunggu";
ALTER TABLE "wa_lapor_sesi" DROP COLUMN IF EXISTS "rapel_ditempel";
ALTER TABLE "wa_lapor_sesi" ADD COLUMN IF NOT EXISTS "rapel_diusulkan" INTEGER NOT NULL DEFAULT 0;
