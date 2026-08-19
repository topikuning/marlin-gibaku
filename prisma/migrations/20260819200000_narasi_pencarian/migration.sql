-- PENCARIAN NARASI LAPANGAN — indeks teks penuh Bahasa Indonesia
-- (DECISIONS 382, Fase F1).
--
-- Kenapa GENERATED ALWAYS, bukan tabel indeks tersendiri:
--
--   Tabel indeks terpisah harus DISINKRONKAN, dan sinkronisasi yang terlewat
--   membuat MARLIN menjawab dari teks yang sudah dikoreksi atau sudah dihapus —
--   kesalahan yang paling sulit terlihat, karena jawabannya tampak normal DAN
--   bersitasi. Kolom generated dipelihara PostgreSQL sendiri pada setiap tulis,
--   lewat jalur apa pun (Prisma, SQL mentah, migrasi), jadi tidak ada yang bisa
--   lupa dan tidak ada yang bisa basi.
--
-- Konfigurasi 'indonesian' bawaan PostgreSQL memang melakukan stemming:
--   'pengecoran' -> 'ecor', 'tertunda' -> 'tunda', 'terlambat' -> 'lambat'.
-- Diperiksa langsung pada PostgreSQL 16.13 yang dipakai proyek ini.
--
-- Idempoten sepenuhnya: aman dijalankan ulang setelah deploy yang gagal separuh
-- jalan (DECISIONS 373).

-- 1. Laporan harian
ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('indonesian', coalesce("notes", ''))) STORED;
CREATE INDEX IF NOT EXISTS "daily_reports_tsv_idx" ON "daily_reports" USING GIN ("tsv");

-- 2. Item laporan harian
ALTER TABLE "daily_report_items"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('indonesian', coalesce("notes", ''))) STORED;
CREATE INDEX IF NOT EXISTS "daily_report_items_tsv_idx" ON "daily_report_items" USING GIN ("tsv");

-- 3. Kegiatan lapangan — judul IKUT diindeks; judulnya sering justru inti
--    kejadiannya ("Rapat percepatan", "Alat rusak").
ALTER TABLE "field_activities"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('indonesian', coalesce("title", '') || ' ' || coalesce("notes", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "field_activities_tsv_idx" ON "field_activities" USING GIN ("tsv");

-- 4. Kendala — judul + uraian
ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('indonesian', coalesce("title", '') || ' ' || coalesce("description", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "issues_tsv_idx" ON "issues" USING GIN ("tsv");

-- 5. Tindakan recovery
ALTER TABLE "recovery_actions"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('indonesian', coalesce("description", ''))) STORED;
CREATE INDEX IF NOT EXISTS "recovery_actions_tsv_idx" ON "recovery_actions" USING GIN ("tsv");
