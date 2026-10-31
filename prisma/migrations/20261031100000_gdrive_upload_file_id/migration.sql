-- Kepemilikan berkas Drive dicek per file_id sebelum MARLIN menimpa atau
-- membuang berkas (DECISIONS 723). Idempoten.
CREATE INDEX IF NOT EXISTS "gdrive_uploads_file_id_idx" ON "gdrive_uploads"("file_id");
