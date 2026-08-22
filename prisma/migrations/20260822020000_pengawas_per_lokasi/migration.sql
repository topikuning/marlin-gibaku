-- KONSULTAN PENGAWAS PER LOKASI (DECISIONS 409).
--
-- Kebutuhan user 2026-08-22: *"untuk tanda tangan laporan, ternyata pengawas
-- per lokasi beda orang."* Sebelum ini pengawas hanya ada di `contracts`, satu
-- untuk seluruh paket — padahal satu paket berisi beberapa lokasi dan tiap
-- lokasi diperiksa orang yang berbeda.
--
-- Bentuknya PERSIS seperti Pelaksana Lapangan (DECISIONS 402): kontrak
-- menyediakan yang berlaku umum, lokasi boleh menimpanya, dan penimpaannya
-- diambil sebagai SATU BLOK dengan nama sebagai penentu. Alasannya di sini
-- bahkan lebih berat — pengawas adalah pihak KETIGA yang memeriksa pekerjaan
-- kita, jadi coretan tanda tangan pengawas paket di bawah nama pengawas lokasi
-- memalsukan pemeriksaannya, bukan sekadar salah tempel gambar.
--
-- TANPA kolom stempel, dan itu disengaja (DECISIONS 408): stempel milik FIRMA,
-- bukan orang. Ia diambil dari `contracts.supervisor_stempel_key`, dan
-- dikosongkan bila lokasi menyebut firma yang berbeda.
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "supervisor_name" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "supervisor_firm" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "supervisor_ttd_key" TEXT;
