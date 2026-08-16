-- Lapisan pencocokan AHSP dari berkas skema 2.1.0 (DECISIONS 321).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

-- Aturan padanan istilah milik BERKASNYA, bukan aturan MARLIN: disimpan
-- bersama sumbernya supaya selalu seumur dengan koefisien yang dipakainya.
ALTER TABLE "ahsp_sources" ADD COLUMN IF NOT EXISTS "matching_engine" JSONB;

-- Default array kosong, bukan NULL: "tidak punya alias" dan "belum diisi" tidak
-- perlu dibedakan di sini, dan kode pembacanya jadi tanpa cabang.
ALTER TABLE "ahsp_entries" ADD COLUMN IF NOT EXISTS "aliases"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ahsp_entries" ADD COLUMN IF NOT EXISTS "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
