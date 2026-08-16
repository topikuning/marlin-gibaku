-- "Tidak ada padanan" disimpan POSITIF, bukan disimpulkan (DECISIONS 323).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

ALTER TABLE "ahsp_padanan" ADD COLUMN IF NOT EXISTS "tidak_ada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ahsp_entries" ADD COLUMN IF NOT EXISTS "legacy_id" TEXT;
CREATE INDEX IF NOT EXISTS "ahsp_entries_legacy_id_idx" ON "ahsp_entries" ("legacy_id");

-- PEMULIHAN DATA.
--
-- Semua baris berpadanan-kosong yang ada SEKARANG sengaja ditinggalkan dengan
-- tidak_ada = false, artinya "tautannya putus, perlu dipetakan ulang" — BUKAN
-- "manusia menyatakan tidak ada".
--
-- Alasannya: dua keadaan itu tidak bisa dibedakan lagi dari data yang tersisa
-- (keduanya entry_id NULL, metode 'koreksi'/'disetujui'), karena analisa yang
-- dulu ditunjuk sudah terhapus bersama sumbernya. Yang bisa dipilih tinggal
-- arah salahnya:
--
--   - dianggap keputusan  → 954 baris hilang dari daftar pekerjaan, senyap,
--                            dan ikut mengecilkan cakupan RAPL tanpa sebab;
--   - dianggap putus      → beberapa pernyataan "memang tidak ada" yang asli
--                            perlu diulang, dan sisanya dipetakan ulang mesin.
--
-- Yang kedua dipilih: salah yang menimbulkan pekerjaan terlihat jauh lebih
-- murah daripada salah yang menyembunyikan pekerjaan.
