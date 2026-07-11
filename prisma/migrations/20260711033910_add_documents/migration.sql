-- CreateEnum
CREATE TYPE "DocumentStage" AS ENUM ('pemilihan', 'penunjukan', 'kontrak', 'mulai_kerja', 'pelaksanaan', 'adendum', 'serah_terima', 'pembayaran', 'lainnya');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('undangan', 'ba_penjelasan', 'penawaran', 'ba_evaluasi', 'ba_klarifikasi', 'ba_negosiasi', 'penetapan_pemenang', 'sanggah', 'sppbj', 'kontrak', 'jaminan', 'spmk', 'ba_serah_terima_lapangan', 'pcm', 'mc0', 'laporan', 'mc_berkala', 'adendum', 'surat_kendala', 'surat_peringatan', 'bast_pho', 'bast_fho', 'ba_pembayaran', 'invoice', 'faktur_pajak', 'lainnya');

-- AlterTable
ALTER TABLE "contractors" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "contracts" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "location_id" UUID,
    "contract_id" UUID,
    "amendment_id" UUID,
    "stage" "DocumentStage" NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "doc_number" TEXT,
    "doc_date" DATE,
    "description" TEXT,
    "r2_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_r2_key_key" ON "documents"("r2_key");

-- CreateIndex
CREATE INDEX "documents_location_id_stage_idx" ON "documents"("location_id", "stage");

-- CreateIndex
CREATE INDEX "documents_contract_id_idx" ON "documents"("contract_id");

-- CreateIndex
CREATE INDEX "documents_org_id_uploaded_at_idx" ON "documents"("org_id", "uploaded_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dokumen wajib nempel ke lokasi ATAU kontrak (tidak boleh orphan).
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_parent_present"
  CHECK ("location_id" IS NOT NULL OR "contract_id" IS NOT NULL);
