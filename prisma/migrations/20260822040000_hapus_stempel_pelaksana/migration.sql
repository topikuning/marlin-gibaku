-- HAPUS KOLOM STEMPEL PELAKSANA (DECISIONS 410).
--
-- Lanjutan DECISIONS 408: stempel milik PERUSAHAAN, bukan orang. Pelaksana
-- Lapangan dan Direktur bekerja di perusahaan yang sama, jadi stempelnya satu —
-- diambil dari `contracts.contractor_stempel_key`, lalu `vendors.stempel_key`.
-- Sejak 408 tidak ada satu pun kode yang membaca maupun menulis kolom ini.
--
-- Kolomnya waktu itu SENGAJA dibiarkan hidup karena berkas yang terlanjur
-- diunggah tidak boleh hilang dari jejak tanpa sepengetahuan pemiliknya.
-- User memastikan 2026-08-22: *"tidak ada stempel yang terlanjur diunggah"*.
-- Baru sesudah kepastian itu kolomnya dibuang — bukan sebaliknya.
--
-- `IF EXISTS`: idempoten, aman dijalankan ulang setelah deploy yang gagal
-- separuh jalan.

ALTER TABLE "packages" DROP COLUMN IF EXISTS "pelaksana_stempel_key";
ALTER TABLE "locations" DROP COLUMN IF EXISTS "pelaksana_stempel_key";
