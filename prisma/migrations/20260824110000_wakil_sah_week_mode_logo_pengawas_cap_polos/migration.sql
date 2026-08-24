-- Wakil Sah (mingguan/bulanan), mode periode minggu, logo pengawas, cap polos
-- galeri (user 2026-08-24). Idempoten (DECISIONS 167).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WeekMode') THEN
    CREATE TYPE "WeekMode" AS ENUM ('tujuh_hari', 'senin_minggu');
  END IF;
END
$$;

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "wakil_sah_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "wakil_sah_nip" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "wakil_sah_ttd_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "supervisor_logo_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "week_mode" "WeekMode" NOT NULL DEFAULT 'tujuh_hari';

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wakil_sah_name" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wakil_sah_nip" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "wakil_sah_ttd_key" TEXT;

ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "stamp_plain" BOOLEAN NOT NULL DEFAULT false;
