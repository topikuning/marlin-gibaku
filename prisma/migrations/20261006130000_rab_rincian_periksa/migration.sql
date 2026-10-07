-- Hasil periksa berkas arsip sebelum rincian RAB dilengkapi (DECISIONS baru 2026-10-06).

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_rincian_periksa" (
    "revision_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "pesan" TEXT,
    "item_revisi" INTEGER NOT NULL DEFAULT 0,
    "item_cocok" INTEGER NOT NULL DEFAULT 0,
    "ringkasan" JSONB,
    "tersembunyi_dibaca" TEXT[],
    "diperiksa_oleh_id" UUID,
    "diperiksa_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rab_rincian_periksa_pkey" PRIMARY KEY ("revision_id")
);

-- AddForeignKey
ALTER TABLE "rab_rincian_periksa" DROP CONSTRAINT IF EXISTS "rab_rincian_periksa_revision_id_fkey";
ALTER TABLE "rab_rincian_periksa" ADD CONSTRAINT "rab_rincian_periksa_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
