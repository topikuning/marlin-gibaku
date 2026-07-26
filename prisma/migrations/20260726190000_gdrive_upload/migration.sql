-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "drive_folder_id" TEXT;

-- CreateTable
CREATE TABLE "gdrive_uploads" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "location_id" UUID,
    "kind" TEXT NOT NULL,
    "ref_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_id" TEXT,
    "web_link" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdrive_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdrive_uploads_package_id_kind_ref_key_created_at_idx" ON "gdrive_uploads"("package_id", "kind", "ref_key", "created_at");

-- AddForeignKey
ALTER TABLE "gdrive_uploads" ADD CONSTRAINT "gdrive_uploads_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

