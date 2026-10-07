-- Rincian berkas RAB per revisi: backup volume, analisa, bahan & upah
-- (DECISIONS baru 2026-10-06). Tidak menyentuh rab_nodes.

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_rincian_revisi" (
    "revision_id" UUID NOT NULL,
    "document_id" UUID,
    "asal" TEXT NOT NULL,
    "sheet_rab" TEXT NOT NULL,
    "kolom_volume" INTEGER NOT NULL,
    "kolom_harga" INTEGER NOT NULL,
    "ringkasan" JSONB NOT NULL,
    "kepala" JSONB NOT NULL,
    "tersembunyi_dibaca" TEXT[],
    "dibuat_oleh_id" UUID,
    "dibuat_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rab_rincian_revisi_pkey" PRIMARY KEY ("revision_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_backup_volume" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "nilai_rab" DECIMAL(24,6),
    "rumus_rab" TEXT,
    "sumber" JSONB NOT NULL,
    "perantara" JSONB NOT NULL,
    "baris" JSONB NOT NULL,
    "terpotong" BOOLEAN NOT NULL DEFAULT false,
    "catatan" TEXT,

    CONSTRAINT "rab_backup_volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_analisa" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "kunci_blok" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "baris_awal" INTEGER NOT NULL,
    "baris_akhir" INTEGER NOT NULL,
    "tersembunyi" BOOLEAN NOT NULL DEFAULT false,
    "kode" TEXT,
    "uraian" TEXT,
    "harga_satuan" DECIMAL(24,6),
    "overhead" DECIMAL(12,6),
    "perantara" JSONB NOT NULL,
    "baris" JSONB NOT NULL,
    "catatan" TEXT,

    CONSTRAINT "rab_analisa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_analisa_komponen" (
    "id" UUID NOT NULL,
    "analisa_id" UUID NOT NULL,
    "urutan" INTEGER NOT NULL,
    "baris" INTEGER NOT NULL,
    "kategori" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "satuan" TEXT,
    "koefisien" DECIMAL(24,8),
    "harga" DECIMAL(24,6),
    "jumlah" DECIMAL(24,6),
    "sumber_sheet" TEXT,
    "sumber_sel" TEXT,

    CONSTRAINT "rab_analisa_komponen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_item_analisa" (
    "revision_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "analisa_id" UUID NOT NULL,
    "cara" TEXT NOT NULL,

    CONSTRAINT "rab_item_analisa_pkey" PRIMARY KEY ("revision_id","lineage_key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rab_harga_dasar" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "sheet" TEXT NOT NULL,
    "sel" TEXT NOT NULL,
    "baris" INTEGER NOT NULL,
    "tersembunyi" BOOLEAN NOT NULL DEFAULT false,
    "nama" TEXT,
    "satuan" TEXT,
    "harga" DECIMAL(24,6),

    CONSTRAINT "rab_harga_dasar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rab_backup_volume_revision_id_lineage_key_key" ON "rab_backup_volume"("revision_id", "lineage_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rab_analisa_revision_id_kunci_blok_key" ON "rab_analisa"("revision_id", "kunci_blok");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rab_analisa_komponen_analisa_id_urutan_idx" ON "rab_analisa_komponen"("analisa_id", "urutan");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rab_item_analisa_analisa_id_idx" ON "rab_item_analisa"("analisa_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rab_harga_dasar_revision_id_sheet_sel_key" ON "rab_harga_dasar"("revision_id", "sheet", "sel");

-- AddForeignKey
ALTER TABLE "rab_rincian_revisi" DROP CONSTRAINT IF EXISTS "rab_rincian_revisi_revision_id_fkey";
ALTER TABLE "rab_rincian_revisi" ADD CONSTRAINT "rab_rincian_revisi_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_backup_volume" DROP CONSTRAINT IF EXISTS "rab_backup_volume_revision_id_fkey";
ALTER TABLE "rab_backup_volume" ADD CONSTRAINT "rab_backup_volume_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_backup_volume" DROP CONSTRAINT IF EXISTS "rab_backup_volume_revision_id_lineage_key_fkey";
ALTER TABLE "rab_backup_volume" ADD CONSTRAINT "rab_backup_volume_revision_id_lineage_key_fkey" FOREIGN KEY ("revision_id", "lineage_key") REFERENCES "rab_nodes"("revision_id", "lineage_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_analisa" DROP CONSTRAINT IF EXISTS "rab_analisa_revision_id_fkey";
ALTER TABLE "rab_analisa" ADD CONSTRAINT "rab_analisa_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_analisa_komponen" DROP CONSTRAINT IF EXISTS "rab_analisa_komponen_analisa_id_fkey";
ALTER TABLE "rab_analisa_komponen" ADD CONSTRAINT "rab_analisa_komponen_analisa_id_fkey" FOREIGN KEY ("analisa_id") REFERENCES "rab_analisa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_item_analisa" DROP CONSTRAINT IF EXISTS "rab_item_analisa_revision_id_fkey";
ALTER TABLE "rab_item_analisa" ADD CONSTRAINT "rab_item_analisa_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_item_analisa" DROP CONSTRAINT IF EXISTS "rab_item_analisa_revision_id_lineage_key_fkey";
ALTER TABLE "rab_item_analisa" ADD CONSTRAINT "rab_item_analisa_revision_id_lineage_key_fkey" FOREIGN KEY ("revision_id", "lineage_key") REFERENCES "rab_nodes"("revision_id", "lineage_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_item_analisa" DROP CONSTRAINT IF EXISTS "rab_item_analisa_analisa_id_fkey";
ALTER TABLE "rab_item_analisa" ADD CONSTRAINT "rab_item_analisa_analisa_id_fkey" FOREIGN KEY ("analisa_id") REFERENCES "rab_analisa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_harga_dasar" DROP CONSTRAINT IF EXISTS "rab_harga_dasar_revision_id_fkey";
ALTER TABLE "rab_harga_dasar" ADD CONSTRAINT "rab_harga_dasar_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
