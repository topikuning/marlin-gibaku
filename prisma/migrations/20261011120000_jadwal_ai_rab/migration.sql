-- Analisa AI urutan pelaksanaan RAB aktif → dasar saran rencana mingguan (DECISIONS 667).
ALTER TYPE "AiRunKind" ADD VALUE IF NOT EXISTS 'jadwal_rab';

CREATE TABLE IF NOT EXISTS "rab_jadwal_ai" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'antre',
    "pending_since" TIMESTAMPTZ,
    "run_id" UUID,
    "provider" TEXT,
    "model" TEXT,
    "galat" TEXT,
    "diminta_oleh_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "selesai_at" TIMESTAMPTZ,
    CONSTRAINT "rab_jadwal_ai_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rab_jadwal_ai_revision_id_key" ON "rab_jadwal_ai"("revision_id");
CREATE INDEX IF NOT EXISTS "rab_jadwal_ai_location_id_idx" ON "rab_jadwal_ai"("location_id");
CREATE INDEX IF NOT EXISTS "rab_jadwal_ai_status_idx" ON "rab_jadwal_ai"("status");

CREATE TABLE IF NOT EXISTS "rab_jadwal_ai_kelompok" (
    "id" UUID NOT NULL,
    "analisa_id" UUID NOT NULL,
    "kategori_key" TEXT NOT NULL,
    "bagian" INTEGER NOT NULL DEFAULT 1,
    "nama" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'antre',
    "hasil" JSONB,
    "galat" TEXT,
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rab_jadwal_ai_kelompok_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rab_jadwal_ai_kelompok_analisa_id_kategori_key_bagian_key"
    ON "rab_jadwal_ai_kelompok"("analisa_id", "kategori_key", "bagian");
ALTER TABLE "rab_jadwal_ai_kelompok" DROP CONSTRAINT IF EXISTS "rab_jadwal_ai_kelompok_analisa_id_fkey";
ALTER TABLE "rab_jadwal_ai_kelompok" ADD CONSTRAINT "rab_jadwal_ai_kelompok_analisa_id_fkey"
    FOREIGN KEY ("analisa_id") REFERENCES "rab_jadwal_ai"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rab_jadwal_ai" DROP CONSTRAINT IF EXISTS "rab_jadwal_ai_revision_id_fkey";
ALTER TABLE "rab_jadwal_ai" ADD CONSTRAINT "rab_jadwal_ai_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
