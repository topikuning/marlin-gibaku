-- Peran Wakil PPK — wakil pemberi kerja, BACA SAJA (DECISIONS 199).
--
-- Tidak punya satu pun capability yang mengubah data, sengaja tanpa `ai.*`
-- (narasi AI tidak boleh sampai ke pemberi kerja sebagai kesimpulan MARLIN),
-- dan tanpa `finance.view` (menu Keuangan = uang internal pelaksana). Bukan
-- lintas-lokasi: hanya lokasi yang ditugaskan. Semua itu ditegakkan di
-- src/lib/authz.ts; migrasi ini hanya menambah nilai enumnya.
--
-- Idempoten: ADD VALUE IF NOT EXISTS.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'wakil_ppk';
