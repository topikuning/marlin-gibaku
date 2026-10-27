-- Persetujuan aktivasi adendum lewat WhatsApp (DECISIONS 714): pesan ke
-- Program Director berisi kode; balasan "SETUJU <kode>" mencatat suaranya.
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaPersetujuanStatus') THEN
    CREATE TYPE "WaPersetujuanStatus" AS ENUM ('menunggu', 'disetujui', 'batal');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wa_persetujuan" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "untuk_user_id" UUID NOT NULL,
    "pemohon_id" UUID NOT NULL,
    "kode" TEXT NOT NULL,
    "draft_diubah_pada" TIMESTAMPTZ NOT NULL,
    "total_value" BIGINT NOT NULL,
    "status" "WaPersetujuanStatus" NOT NULL DEFAULT 'menunggu',
    "kunci_menunggu" TEXT,
    "gagal_kirim" TEXT,
    "alasan_batal" TEXT,
    "selesai_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wa_persetujuan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_persetujuan_kunci_menunggu_key" ON "wa_persetujuan"("kunci_menunggu");
CREATE INDEX IF NOT EXISTS "wa_persetujuan_revision_id_status_idx" ON "wa_persetujuan"("revision_id", "status");
CREATE INDEX IF NOT EXISTS "wa_persetujuan_untuk_user_id_status_idx" ON "wa_persetujuan"("untuk_user_id", "status");

ALTER TABLE "wa_persetujuan" DROP CONSTRAINT IF EXISTS "wa_persetujuan_revision_id_fkey";
ALTER TABLE "wa_persetujuan" ADD CONSTRAINT "wa_persetujuan_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_persetujuan" DROP CONSTRAINT IF EXISTS "wa_persetujuan_untuk_user_id_fkey";
ALTER TABLE "wa_persetujuan" ADD CONSTRAINT "wa_persetujuan_untuk_user_id_fkey"
  FOREIGN KEY ("untuk_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_persetujuan" DROP CONSTRAINT IF EXISTS "wa_persetujuan_pemohon_id_fkey";
ALTER TABLE "wa_persetujuan" ADD CONSTRAINT "wa_persetujuan_pemohon_id_fkey"
  FOREIGN KEY ("pemohon_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
