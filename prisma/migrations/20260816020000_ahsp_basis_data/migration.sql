-- Basis data AHSP SE DJBK 47/2026 (DECISIONS 317).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

CREATE TABLE IF NOT EXISTS "ahsp_sources" (
    "id"             UUID        NOT NULL,
    "code"           TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    "subject"        TEXT,
    "schema_version" TEXT        NOT NULL,
    "generated_at"   TIMESTAMPTZ NOT NULL,
    "documents"      JSONB       NOT NULL,
    "file_sha256"    TEXT        NOT NULL,
    "imported_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" UUID,

    CONSTRAINT "ahsp_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ahsp_sources_code_key" ON "ahsp_sources" ("code");

CREATE TABLE IF NOT EXISTS "ahsp_entries" (
    "id"                UUID    NOT NULL,
    "source_id"         UUID    NOT NULL,
    "external_id"       TEXT    NOT NULL,
    "kode"              TEXT    NOT NULL,
    "uraian"            TEXT    NOT NULL,
    "satuan"            TEXT    NOT NULL,
    "bidang"            TEXT    NOT NULL,
    "ahsp_type"         TEXT    NOT NULL,
    "work_group"        TEXT,
    "divisi"            TEXT,
    "notes"             TEXT,
    "perlu_verifikasi"  BOOLEAN NOT NULL DEFAULT false,
    "lampiran"          TEXT,
    "toc_pdf_page"      INTEGER,
    "analysis_pdf_page" INTEGER,
    "excerpt_id"        TEXT,

    CONSTRAINT "ahsp_entries_pkey" PRIMARY KEY ("id")
);

-- Kunci alami: id dari berkas master, BUKAN kode — berkas resminya memuat kode
-- duplikat untuk analisa yang uraian/satuannya berbeda.
CREATE UNIQUE INDEX IF NOT EXISTS "ahsp_entries_source_id_external_id_key"
    ON "ahsp_entries" ("source_id", "external_id");
CREATE INDEX IF NOT EXISTS "ahsp_entries_source_id_bidang_idx" ON "ahsp_entries" ("source_id", "bidang");
CREATE INDEX IF NOT EXISTS "ahsp_entries_source_id_kode_idx" ON "ahsp_entries" ("source_id", "kode");

CREATE TABLE IF NOT EXISTS "ahsp_components" (
    "id"        UUID           NOT NULL,
    "entry_id"  UUID           NOT NULL,
    "kategori"  TEXT           NOT NULL,
    "nama"      TEXT           NOT NULL,
    "satuan"    TEXT,
    "koefisien" DECIMAL(18,8)  NOT NULL,
    "urutan"    INTEGER        NOT NULL,

    CONSTRAINT "ahsp_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ahsp_components_entry_id_urutan_idx" ON "ahsp_components" ("entry_id", "urutan");
-- Jalur baca RAPL: "semua analisa yang memakai bahan X".
CREATE INDEX IF NOT EXISTS "ahsp_components_kategori_nama_idx" ON "ahsp_components" ("kategori", "nama");

ALTER TABLE "ahsp_entries" DROP CONSTRAINT IF EXISTS "ahsp_entries_source_id_fkey";
ALTER TABLE "ahsp_entries" ADD CONSTRAINT "ahsp_entries_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "ahsp_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_components" DROP CONSTRAINT IF EXISTS "ahsp_components_entry_id_fkey";
ALTER TABLE "ahsp_components" ADD CONSTRAINT "ahsp_components_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "ahsp_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
