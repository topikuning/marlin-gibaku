-- KRONOLOGI LOKASI sebagai jenis run AI (permintaan user 2026-08-31).
--
-- Tidak ada tabel baru: kronologi memakai lifecycle AiRun yang sudah ada —
-- snapshot sumber, guard kuota, grounding, dan riwayat run berlaku sama seperti
-- jenis lain. Yang ditambah hanya jenisnya.
--
-- Idempoten: ADD VALUE IF NOT EXISTS.
ALTER TYPE "AiRunKind" ADD VALUE IF NOT EXISTS 'kronologi';
