-- Status baru: lampiran yang umur simpannya habis tanpa pernah ditetapkan.
--
-- Berkasnya dihapus (foto 3 hari, berkas lain 14 hari), barisnya tetap ada
-- sebagai catatan "pernah ada berkas ini" dan keluar dari daftar tunggu.
--
-- `IF NOT EXISTS` membuat migrasi ini aman dijalankan ulang; ALTER TYPE ADD
-- VALUE tidak bisa dibungkus transaksi bersama pemakaiannya, tapi di sini ia
-- berdiri sendiri.
ALTER TYPE "WaAttachmentStatus" ADD VALUE IF NOT EXISTS 'kedaluwarsa';
