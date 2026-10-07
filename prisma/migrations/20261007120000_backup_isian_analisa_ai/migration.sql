-- Backup volume isian MARLIN + draf analisa AI untuk RAPL (DECISIONS baru 2026-10-07).

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_backup_isian" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "urutan" INTEGER NOT NULL,
    "uraian" TEXT NOT NULL,
    "jumlah" DECIMAL(18,4),
    "panjang" DECIMAL(18,4),
    "lebar" DECIMAL(18,4),
    "tinggi" DECIMAL(18,4),
    "kurang" BOOLEAN NOT NULL DEFAULT false,
    "keterangan" TEXT,
    "dibuat_oleh_id" UUID NOT NULL,
    "dibuat_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rab_backup_isian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rapl_analisa_ai_run" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'menunggu',
    "pending_since" TIMESTAMPTZ,
    "model" TEXT,
    "error_message" TEXT,
    "diminta" INTEGER NOT NULL DEFAULT 0,
    "total_tanpa" INTEGER NOT NULL DEFAULT 0,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selesai_at" TIMESTAMPTZ,

    CONSTRAINT "rapl_analisa_ai_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rapl_analisa_ai" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "uraian" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "keyakinan" TEXT NOT NULL,
    "alasan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draf',
    "diputuskan_oleh_id" UUID,
    "diputuskan_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rapl_analisa_ai_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rapl_analisa_ai_komponen" (
    "id" UUID NOT NULL,
    "usulan_id" UUID NOT NULL,
    "urutan" INTEGER NOT NULL,
    "kategori" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "koefisien" DECIMAL(24,8) NOT NULL,

    CONSTRAINT "rapl_analisa_ai_komponen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rab_backup_isian_revision_id_lineage_key_urutan_idx" ON "rab_backup_isian"("revision_id", "lineage_key", "urutan");
CREATE INDEX IF NOT EXISTS "rapl_analisa_ai_run_location_id_created_at_idx" ON "rapl_analisa_ai_run"("location_id", "created_at");
CREATE INDEX IF NOT EXISTS "rapl_analisa_ai_run_pending_since_idx" ON "rapl_analisa_ai_run"("pending_since");
CREATE INDEX IF NOT EXISTS "rapl_analisa_ai_location_id_lineage_key_status_idx" ON "rapl_analisa_ai"("location_id", "lineage_key", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "rapl_analisa_ai_run_id_lineage_key_key" ON "rapl_analisa_ai"("run_id", "lineage_key");
CREATE INDEX IF NOT EXISTS "rapl_analisa_ai_komponen_usulan_id_urutan_idx" ON "rapl_analisa_ai_komponen"("usulan_id", "urutan");

-- AddForeignKey
ALTER TABLE "rab_backup_isian" DROP CONSTRAINT IF EXISTS "rab_backup_isian_revision_id_fkey";
ALTER TABLE "rab_backup_isian" ADD CONSTRAINT "rab_backup_isian_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rab_backup_isian" DROP CONSTRAINT IF EXISTS "rab_backup_isian_revision_id_lineage_key_fkey";
ALTER TABLE "rab_backup_isian" ADD CONSTRAINT "rab_backup_isian_revision_id_lineage_key_fkey" FOREIGN KEY ("revision_id", "lineage_key") REFERENCES "rab_nodes"("revision_id", "lineage_key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rab_backup_isian" DROP CONSTRAINT IF EXISTS "rab_backup_isian_dibuat_oleh_id_fkey";
ALTER TABLE "rab_backup_isian" ADD CONSTRAINT "rab_backup_isian_dibuat_oleh_id_fkey" FOREIGN KEY ("dibuat_oleh_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai_run" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_run_location_id_fkey";
ALTER TABLE "rapl_analisa_ai_run" ADD CONSTRAINT "rapl_analisa_ai_run_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai_run" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_run_requested_by_id_fkey";
ALTER TABLE "rapl_analisa_ai_run" ADD CONSTRAINT "rapl_analisa_ai_run_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_run_id_fkey";
ALTER TABLE "rapl_analisa_ai" ADD CONSTRAINT "rapl_analisa_ai_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "rapl_analisa_ai_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_location_id_fkey";
ALTER TABLE "rapl_analisa_ai" ADD CONSTRAINT "rapl_analisa_ai_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_diputuskan_oleh_id_fkey";
ALTER TABLE "rapl_analisa_ai" ADD CONSTRAINT "rapl_analisa_ai_diputuskan_oleh_id_fkey" FOREIGN KEY ("diputuskan_oleh_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rapl_analisa_ai_komponen" DROP CONSTRAINT IF EXISTS "rapl_analisa_ai_komponen_usulan_id_fkey";
ALTER TABLE "rapl_analisa_ai_komponen" ADD CONSTRAINT "rapl_analisa_ai_komponen_usulan_id_fkey" FOREIGN KEY ("usulan_id") REFERENCES "rapl_analisa_ai"("id") ON DELETE CASCADE ON UPDATE CASCADE;
