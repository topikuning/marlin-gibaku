-- Dokumentasi foto per bangunan di Drive lewat shortcut (DECISIONS 666).
ALTER TABLE "gdrive_uploads" ADD COLUMN IF NOT EXISTS "photo_id" UUID;
CREATE INDEX IF NOT EXISTS "gdrive_uploads_photo_id_idx" ON "gdrive_uploads"("photo_id");

CREATE TABLE IF NOT EXISTS "gdrive_pintasan_foto" (
    "photo_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "revision_id" UUID,
    "target_id" TEXT,
    "shortcut_id" TEXT,
    "folder_id" TEXT,
    "bangunan" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "gdrive_pintasan_foto_pkey" PRIMARY KEY ("photo_id")
);
CREATE INDEX IF NOT EXISTS "gdrive_pintasan_foto_report_id_idx" ON "gdrive_pintasan_foto"("report_id");
CREATE INDEX IF NOT EXISTS "gdrive_pintasan_foto_location_id_idx" ON "gdrive_pintasan_foto"("location_id");
