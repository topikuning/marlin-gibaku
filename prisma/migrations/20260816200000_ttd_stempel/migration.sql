-- Tanda tangan & stempel untuk laporan yang dicetak (DECISIONS 328).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

-- Di KONTRAK, karena nama penanda tangannya (ppk_name, supervisor_name,
-- contractor_signer_name) memang sudah di sini: pergantian personel di satu
-- paket tidak boleh mengubah dokumen paket lain.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "ppk_ttd_key"            TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "ppk_stempel_key"        TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "supervisor_ttd_key"     TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "supervisor_stempel_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contractor_ttd_key"     TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "contractor_stempel_key" TEXT;

-- Stempel perusahaan sebagai CADANGAN: satu perusahaan satu stempel, dan itu
-- memang benda fisik yang sama di semua kontraknya.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "stempel_key" TEXT;
