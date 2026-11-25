-- DECISIONS 781: volume yang masuk ke item tujuan diisi orang (satuan item tujuan).
-- Kosong = usulan lama: volume asalnya, dipotong ke sisa.
ALTER TABLE "rab_padanan_aktif" ADD COLUMN IF NOT EXISTS "volume_diminta" DECIMAL(15,3);
