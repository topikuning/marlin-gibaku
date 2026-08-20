-- SATU PUSAT KENDALA (DECISIONS 392).
--
-- Keberatan user 2026-08-20: "pencatatan kendala, saat ini menurutku tidak
-- efektif, setelah dicatat tidak ada tindak lanjut, lalu akan rancu dengan
-- kendala di laporan harian atau kegiatan lapangan."
--
-- Yang ditambahkan di sini semuanya menjawab satu hal: kendala harus punya
-- PEMILIK dan TENGGAT supaya bisa ditagih. Sebelum ini PIC hanya ada di
-- `recovery_actions`, jadi kendala baru bermilik setelah seseorang sempat
-- merencanakan pemulihan — padahal justru yang belum disentuh yang paling
-- perlu ditagih.
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

-- Enum sumber kendala. PostgreSQL tidak punya CREATE TYPE IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IssueSource') THEN
    CREATE TYPE "IssueSource" AS ENUM ('manual', 'laporan_harian', 'kegiatan_lapangan', 'ai');
  END IF;
END
$$;

ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "source" "IssueSource" NOT NULL DEFAULT 'manual';
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "field_activity_id" UUID;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "pic_user_id" UUID;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "pic_name" TEXT;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "due_date" DATE;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closing_note" TEXT;

-- Kendala yang sudah terlanjur berstatus `selesai` diberi `closed_at` dari
-- `updated_at` — perkiraan terbaik yang ADA di data, bukan karangan. Tanpa ini
-- papan "selesai 30 hari terakhir" akan mengosongkan seluruh riwayat lama.
UPDATE "issues"
   SET "closed_at" = "updated_at"
 WHERE "status" = 'selesai' AND "closed_at" IS NULL;

/*
 * Sumber diturunkan dari data yang sudah ada: kendala ber-`report_id` memang
 * lahir dari laporan harian. Sisanya dibiarkan 'manual' — menebak lebih jauh
 * berarti mengarang asal-usul yang tidak tercatat di mana pun.
 */
UPDATE "issues" SET "source" = 'laporan_harian'
 WHERE "report_id" IS NOT NULL AND "source" = 'manual';

CREATE INDEX IF NOT EXISTS "issues_status_due_date_idx" ON "issues"("status", "due_date");
CREATE INDEX IF NOT EXISTS "issues_field_activity_id_idx" ON "issues"("field_activity_id");
