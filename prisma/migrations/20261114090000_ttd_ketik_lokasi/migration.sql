-- Tanda tangan ketik dari nama (DECISIONS 763) kini dinyalakan per lokasi,
-- bawaan MATI (DECISIONS 766). Lokasi yang sudah ada ikut mati: slot tanpa
-- coretan kembali tercetak kosong sampai dinyalakan di halaman lokasinya.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "ttd_ketik" BOOLEAN NOT NULL DEFAULT false;
