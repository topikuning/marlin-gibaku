-- Buang kolom `tsv` sisa versi pertama DECISIONS 382 (revisi 384).
--
-- Basis data yang SUDAH menerapkan versi pertama (mis. dev) punya kolom
-- `GENERATED ALWAYS ... STORED` yang kini tidak dipakai siapa pun — query
-- memakai indeks ekspresi. Membiarkannya berarti menyimpan salinan kedua
-- seluruh tsvector: pada ukuran uji, 25 MB + 77 MB terbuang percuma.
--
-- Pada basis data BARU (mis. produksi) kolom itu tidak pernah ada, jadi seluruh
-- berkas ini no-op — `DROP COLUMN IF EXISTS` hanya mengubah katalog, tidak
-- pernah menulis ulang tabel, dan `CREATE INDEX IF NOT EXISTS` melihat indeks
-- ekspresinya sudah terpasang oleh migrasi sebelumnya.
--
-- Indeks GIN lama ikut terhapus otomatis bersama kolomnya.

ALTER TABLE "daily_reports" DROP COLUMN IF EXISTS "tsv";
ALTER TABLE "daily_report_items" DROP COLUMN IF EXISTS "tsv";
ALTER TABLE "field_activities" DROP COLUMN IF EXISTS "tsv";
ALTER TABLE "issues" DROP COLUMN IF EXISTS "tsv";
ALTER TABLE "recovery_actions" DROP COLUMN IF EXISTS "tsv";

-- Jaring pengaman: bila migrasi sebelumnya sudah tercatat terpasang dalam
-- bentuk LAMA (kolom, bukan indeks ekspresi), ia tidak akan dijalankan ulang —
-- jadi indeksnya dibuat di sini.
CREATE INDEX IF NOT EXISTS "daily_reports_tsv_idx"
  ON "daily_reports" USING GIN (to_tsvector('indonesian', coalesce("notes", '')));
CREATE INDEX IF NOT EXISTS "daily_report_items_tsv_idx"
  ON "daily_report_items" USING GIN (to_tsvector('indonesian', coalesce("notes", '')));
CREATE INDEX IF NOT EXISTS "field_activities_tsv_idx"
  ON "field_activities" USING GIN (
    to_tsvector('indonesian', coalesce("title", '') || ' ' || coalesce("notes", ''))
  );
CREATE INDEX IF NOT EXISTS "issues_tsv_idx"
  ON "issues" USING GIN (
    to_tsvector('indonesian', coalesce("title", '') || ' ' || coalesce("description", ''))
  );
CREATE INDEX IF NOT EXISTS "recovery_actions_tsv_idx"
  ON "recovery_actions" USING GIN (to_tsvector('indonesian', coalesce("description", '')));
