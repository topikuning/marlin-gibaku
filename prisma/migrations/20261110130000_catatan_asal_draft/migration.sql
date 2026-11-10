-- Baris laporan yang item draft-nya hilang saat draft diganti berkas baru
-- disimpan sebagai catatan pekerjaan di luar RAB (DECISIONS 755).
-- Nomor draft asalnya; null = dicatat pelaksana sendiri.
ALTER TABLE "pekerjaan_luar_rab" ADD COLUMN IF NOT EXISTS "asal_draft_no" INTEGER;
