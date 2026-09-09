-- ARSIP DINGIN BERKAS ASLI FOTO
--
-- Empat kolom, tanpa enum dan tanpa tabel antrean. Dua tanggal sudah menyatakan
-- seluruh keadaan yang mungkin, dan keduanya hanya bergerak maju:
--
--   original_archived_at NULL                          → asli ada di R2
--   archived_at terisi, r2_purged_at NULL              → ada di KEDUANYA
--   keduanya terisi                                    → hanya di arsip dingin
--
-- Baris lama tidak perlu disentuh: NULL sudah berarti "masih di R2", yang
-- memang keadaan mereka. Tidak ada backfill, tidak ada UPDATE massal.
--
-- CATATAN: `prisma migrate dev` membangkitkan berkas ini bersama puluhan
-- perubahan lain (drop index, drop default, rename index) karena basis data DEV
-- sudah menyimpang dari riwayat migrasi. Semua itu DIBUANG dari sini — migrasi
-- ini hanya boleh berisi perubahan yang memang diminta pekerjaannya. Penyimpangan
-- dev-nya sendiri dicatat terpisah, bukan diselundupkan lewat migrasi fitur.
-- `IF NOT EXISTS` di setiap pernyataan, bukan kerapian melainkan syarat
-- (DECISIONS 167): Prisma menjalankan migrasi satu pernyataan per pernyataan,
-- BUKAN dalam satu transaksi. Kalau pernyataan ketiga gagal, dua yang pertama
-- terlanjur tersimpan, migrasinya tercatat gagal, dan seluruh deploy
-- berikutnya terblokir sampai ada yang membereskannya dengan tangan.
ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "original_archived_at"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "original_r2_purged_at"  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "original_archive_tries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "original_archive_error" TEXT;

-- Antreannya adalah kueri, bukan tabel. Indeks parsial ini yang membuatnya
-- murah: hanya baris yang benar-benar menunggu yang masuk indeks, jadi
-- ukurannya menyusut sendiri seiring arsip berjalan.
CREATE INDEX IF NOT EXISTS "photos_menunggu_arsip_idx"
  ON "photos" ("created_at")
  WHERE "original_key" IS NOT NULL AND "original_archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "photos_menunggu_buang_r2_idx"
  ON "photos" ("original_archived_at")
  WHERE "original_archived_at" IS NOT NULL AND "original_r2_purged_at" IS NULL;
