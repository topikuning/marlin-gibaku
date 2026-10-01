-- DECISIONS 645: berkas yang dipindah dari R2 ke arsip Lenovo.
CREATE TABLE IF NOT EXISTS "berkas_pindah" (
    "kunci" TEXT NOT NULL,
    "kunci_dingin" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "content_type" TEXT,
    "dipindah_at" TIMESTAMPTZ,
    "r2_dibuang_at" TIMESTAMPTZ,
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "galat" TEXT,
    "dicoba_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "berkas_pindah_pkey" PRIMARY KEY ("kunci")
);

CREATE INDEX IF NOT EXISTS "berkas_pindah_dipindah_at_idx" ON "berkas_pindah"("dipindah_at");
