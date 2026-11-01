-- Revisi RAB jenis KOREKSI: perbaikan oleh super admin, bukan tahap adendum (DECISIONS 728).
-- Dipisah dari migrasi pengisiannya: nilai enum baru belum bisa dipakai di transaksi yang sama.
ALTER TYPE "RabRevisionSource" ADD VALUE IF NOT EXISTS 'koreksi';
