-- Periode minggu dengan hari mulai bebas (DECISIONS 708): tujuh hari mulai
-- minggu kalender + 7 hari sejak SPMK. Nilai lama (`tujuh_hari`,
-- `senin_minggu`) tidak berubah, jadi tidak ada data yang dikonversi.
-- Idempoten: ADD VALUE IF NOT EXISTS.
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'selasa_senin';
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'rabu_selasa';
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'kamis_rabu';
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'jumat_kamis';
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'sabtu_jumat';
ALTER TYPE "WeekMode" ADD VALUE IF NOT EXISTS 'minggu_sabtu';
