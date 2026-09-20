-- PROFIL KURVA-S PADA BASELINE — permintaan user 2026-09-19.
--
-- Kurva-S bawaan saat RAB diimpor kini berbentuk "awal lambat": rasio
-- 1-3-6-11-18-28-40-54-68-80-89-94-97-99-100 yang dibaca sebagai BENTUK
-- (`src/lib/scurve/profil.ts`), bukan daftar minggu. Alasannya dari lapangan:
-- *"dalam 3 minggu, bahkan kalau bisa 4 minggu pertama, itu banyak tidak ada
-- kegiatan karena persiapan dan bisa jadi di lapangan lahan bermasalah"*.
-- Bentuk lama — penjadwal urutan pekerjaan yang naik sejak minggu satu — tetap
-- ada dan bisa dipilih, namanya `optimal`.
--
-- Kolom ini menyimpan bentuk yang dipakai saat baris ini dibuat, SEKALIGUS
-- menjadi bentuk yang dipakai regenerate BERIKUTNYA di lokasi yang sama. Tanpa
-- itu, tombol "Hitung ulang kurva-S" pada lokasi yang sudah sengaja memilih
-- `optimal` akan diam-diam mengembalikannya ke `lambat` — persis pemaksaan yang
-- dikeluhkan user.
--
-- ── KENAPA BAWAAN KOLOMNYA `optimal`, BUKAN `lambat` ──────────────────────────
--
-- Seluruh baris yang sudah ada di basis data MEMANG dihasilkan penjadwal
-- urutan-pekerjaan. Menandainya `lambat` cuma karena itu bawaan yang baru akan
-- berbohong tentang sejarah: layar akan menyebut "profil awal lambat" di atas
-- kurva yang naik sejak minggu pertama, dan tidak ada satu pun cara membedakan
-- baseline yang benar-benar dibuat dengan profil lambat dari yang cuma kena
-- bawaan migrasi.
--
-- Bawaan untuk pembuatan BARU adalah `lambat`, dan itu ada di KODE
-- (`PROFIL_KURVA_DEFAULT`), bukan di sini. Dua bawaan yang berbeda memang
-- disengaja: satu menjawab "baris lama ini dulu dibuat bagaimana", satu lagi
-- menjawab "kalau tidak dipilih, pakai yang mana".
--
-- `manual` TIDAK ada di enum ini. Ia pilihan LAYAR yang artinya "jangan buat
-- kurva sekarang" — tidak ada baseline yang lahir dari pilihan itu, jadi tidak
-- ada baris yang bisa menyandangnya.
--
-- Idempoten (dijalankan ulang aman): PostgreSQL tidak punya
-- `CREATE TYPE IF NOT EXISTS`, jadi tipenya dibuat di dalam blok berpenjaga
-- `pg_type` — bentuk yang sama dengan migrasi enum lain di repo ini dan yang
-- dituntut `tests/unit/migrasi-idempoten`. `EXCEPTION WHEN duplicate_object`
-- ikut dipasang sebagai jaring kedua untuk deploy yang berbarengan: penjaga
-- pg_type memeriksa lebih dulu, dan di antara pemeriksaan dan pembuatan masih
-- ada celah yang cuma bisa ditutup dari sisi galatnya.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BaselineProfil') THEN
    CREATE TYPE "BaselineProfil" AS ENUM ('lambat', 'optimal');
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "baselines"
  ADD COLUMN IF NOT EXISTS "profil" "BaselineProfil" NOT NULL DEFAULT 'optimal';
