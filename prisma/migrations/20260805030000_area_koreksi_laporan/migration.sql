-- AREA KOREKSI LAPORAN HARIAN (DECISIONS 256)
--
-- ADITIF (DECISIONS 253): satu tipe enum baru dan satu kolom baru berdefault
-- array kosong. Tidak ada ALTER pada kolom lama, tidak ada UPDATE, tidak ada
-- backfill — laporan lama tetap ber-array kosong, yang artinya "dikembalikan
-- tanpa penunjuk bagian". Itu memang keadaan sebenarnya; mengarang bagian untuk
-- data lama justru membuat riwayat berbohong.
--
-- Di PostgreSQL 11+ menambah kolom dengan DEFAULT non-volatile hanya mengubah
-- katalog, bukan menulis ulang tabel — jadi aman di tabel laporan yang sudah
-- berisi dan di database yang dipakai bersama.
--
-- IDEMPOTEN (DECISIONS 167): enum berpenjaga pg_type, kolom pakai IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CorrectionArea') THEN
    CREATE TYPE "CorrectionArea" AS ENUM ('volume', 'foto', 'cuaca', 'tenaga_material', 'kendala', 'lainnya');
  END IF;
END
$$;

ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "correction_areas" "CorrectionArea"[] NOT NULL DEFAULT '{}';
