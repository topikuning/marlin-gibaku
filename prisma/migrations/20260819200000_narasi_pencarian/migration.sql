-- PENCARIAN NARASI LAPANGAN — indeks teks penuh Bahasa Indonesia
-- (DECISIONS 382, direvisi 384 sebelum menyentuh produksi).
--
-- INDEKS EKSPRESI, bukan kolom `GENERATED ALWAYS ... STORED`.
--
-- Versi pertama menambah kolom tsvector tersimpan. Itu bekerja, tapi
-- `ALTER TABLE ... ADD COLUMN ... GENERATED ... STORED` MENULIS ULANG seluruh
-- tabel sambil memegang kunci ACCESS EXCLUSIVE — baca DAN tulis mati selama
-- proses. Diukur pada PostgreSQL 16.13 dengan 100.000 laporan + 500.000 item:
--
--   kolom GENERATED + GIN : 13,2 detik  · tabel 49 MB + 168 MB · baca & tulis MATI
--   indeks ekspresi       :  8,5 detik  · tabel 24 MB +  91 MB · baca TETAP JALAN
--
-- Indeks ekspresi menang di setiap sumbu, dan yang menentukan bukan kecepatannya
-- melainkan KUNCINYA: `CREATE INDEX` memakai kunci SHARE, jadi pembacaan tetap
-- berjalan. Pada basis data produksi yang sudah berisi banyak data, beda antara
-- "lambat sebentar" dan "aplikasi mati sebentar" itu beda yang sebenarnya.
--
-- Query di `src/lib/narasi/cari.ts` menuliskan ekspresi yang SAMA PERSIS supaya
-- perencana memakai indeks ini (terbukti lewat EXPLAIN: Bitmap Index Scan).
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

CREATE INDEX IF NOT EXISTS "daily_reports_tsv_idx"
  ON "daily_reports" USING GIN (to_tsvector('indonesian', coalesce("notes", '')));

CREATE INDEX IF NOT EXISTS "daily_report_items_tsv_idx"
  ON "daily_report_items" USING GIN (to_tsvector('indonesian', coalesce("notes", '')));

-- Judul kegiatan IKUT diindeks; judulnya sering justru inti kejadiannya
-- ("Rapat percepatan", "Alat rusak").
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
