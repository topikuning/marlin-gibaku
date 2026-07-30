-- Dokumen: siklus hidup (batalkan / hapus permanen) + asal berkas dari Drive KKP.
--
-- 1. `status` + jejak pembatalan. Sebelumnya dokumen sama sekali tidak bisa
--    dikoreksi maupun dibuang: salah unggah (salah lokasi, salah jenis, file
--    keliru) menetap selamanya dan tetap dihitung sebagai bukti milestone.
--    Kebijakan baru: BATALKAN (reversibel, file & audit utuh) untuk semua yang
--    berwenang; HAPUS PERMANEN hanya super_admin dan hanya atas dokumen yang
--    sudah dibatalkan.
--
-- 2. `source` + kolom `drive_*` merekam berkas yang ditarik dari folder Google
--    Drive KKP. Isi file tetap disalin ke R2 (bukan hanya ditautkan) supaya
--    arsip MARLIN tidak ikut hilang bila KKP memindah/menghapus file di Drive;
--    `drive_file_id` unik per organisasi supaya impor ulang tidak menggandakan.
--
-- IDEMPOTEN — Prisma menjalankan pernyataan satu per satu (bukan satu
-- transaksi); file ini aman dijalankan ulang setelah kegagalan separuh jalan.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
    CREATE TYPE "DocumentStatus" AS ENUM ('aktif', 'dibatalkan');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentSource') THEN
    CREATE TYPE "DocumentSource" AS ENUM ('unggahan', 'drive_kkp');
  END IF;
END
$$;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "status" "DocumentStatus" NOT NULL DEFAULT 'aktif';
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "voided_by_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "void_reason" TEXT;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "source" "DocumentSource" NOT NULL DEFAULT 'unggahan';
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "drive_file_id" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "drive_web_link" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "drive_path" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "drive_modified_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_drive_file_key"
  ON "documents" ("org_id", "drive_file_id");

CREATE INDEX IF NOT EXISTS "documents_org_id_status_idx"
  ON "documents" ("org_id", "status");
