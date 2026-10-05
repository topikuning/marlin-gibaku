-- DECISIONS 650: berkas yang sudah disalin ke Google Drive cadangan.
CREATE TABLE IF NOT EXISTS "cadangan_berkas" (
    "kunci" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "md5" TEXT,
    "drive_file_id" TEXT,
    "dicadangkan_at" TIMESTAMPTZ,
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "galat" TEXT,
    "dicoba_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cadangan_berkas_pkey" PRIMARY KEY ("kunci")
);

CREATE INDEX IF NOT EXISTS "cadangan_berkas_dicadangkan_at_idx" ON "cadangan_berkas"("dicadangkan_at");
