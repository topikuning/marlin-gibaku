-- KAPAN TERAKHIR DICOBA — supaya yang berhenti dicoba bisa PULIH SENDIRI.
--
-- Tanpa kolom ini, baris yang gagal 5 kali berhenti dicoba SELAMANYA sampai ada
-- orang yang menengok layar. Gangguan jaringan beberapa jam — hal yang wajar di
-- uplink rumah — akan menghasilkan tumpukan yang tidak pernah beres sendiri
-- walau penyebabnya sudah lama hilang.
--
-- `originalArchiveTries` sendirian tidak cukup: ia tahu BERAPA kali gagal, tidak
-- tahu KAPAN. Tanpa "kapan", tidak ada cara membedakan gagal lima menit lalu
-- dari gagal minggu lalu.
--
-- `IF NOT EXISTS` bukan kerapian melainkan syarat (DECISIONS 167): Prisma
-- menjalankan migrasi satu pernyataan per pernyataan, BUKAN dalam satu
-- transaksi.
ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "original_archive_tried_at" TIMESTAMPTZ;
