-- PELAKSANA LAPANGAN SEBAGAI PENANDA TANGAN (DECISIONS 402).
--
-- Kebutuhan user 2026-08-21: laporan HARIAN dan MINGGUAN diteken Pelaksana
-- Lapangan, sedangkan BULANAN, MC, dan CCO diteken Direktur. Sebelum ini
-- SEMUA dokumen memakai satu nama yang sama — Contract.contractor_signer_name,
-- yaitu direkturnya. Artinya laporan harian menyatakan direktur yang membuatnya,
-- padahal yang mengisi dan meneken di lapangan orang lain.
--
-- Disimpan di PAKET (bukan kontrak): orangnya melekat pada pelaksanaan
-- pekerjaan, bukan pada berkas kontraknya, dan tetap ada saat kontrak diganti.
-- Lokasi boleh MENIMPA dengan orang lain — satu paket bisa berisi dua lokasi
-- yang dikerjakan pelaksana berbeda.
--
-- Nama dan gambar tanda tangannya sengaja disimpan berdampingan supaya bisa
-- diambil sebagai SATU BLOK. Mencampur nama dari lokasi dengan tanda tangan
-- dari paket berarti membubuhkan coretan seseorang di bawah nama orang lain.
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "pelaksana_name" TEXT;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "pelaksana_title" TEXT;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "pelaksana_ttd_key" TEXT;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "pelaksana_stempel_key" TEXT;

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "pelaksana_name" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "pelaksana_title" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "pelaksana_ttd_key" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "pelaksana_stempel_key" TEXT;
