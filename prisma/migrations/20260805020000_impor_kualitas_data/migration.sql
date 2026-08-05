-- IMPOR & KUALITAS DATA (DECISIONS 253/254)
--
-- ADITIF SEPENUHNYA. Database ini dipakai bersama pengembangan lain, jadi
-- migrasi ini sengaja tidak menyentuh satu pun tabel atau kolom yang sudah ada:
-- hanya tiga tipe enum baru dan dua tabel baru. Tidak ada ALTER pada tabel
-- lama, tidak ada UPDATE, tidak ada backfill. Kasus terburuknya adalah "ada dua
-- tabel yang belum berisi apa-apa" — bukan kehilangan data.
--
-- Relasi ke organizations/users/locations/packages dibuat sebagai FOREIGN KEY
-- dari tabel BARU ke tabel lama; arah itu tidak mengubah bentuk tabel lama.
-- ON DELETE SET NULL dipakai untuk lokasi/paket/user supaya menghapus salah
-- satunya tidak ikut menghapus JEJAK impornya — jejak yang hilang bersama
-- objeknya membuat riwayat berbohong tentang apa yang pernah terjadi.
--
-- IDEMPOTEN (DECISIONS 167): Prisma menjalankan pernyataan SATU PER SATU, bukan
-- dalam satu transaksi, jadi kegagalan di tengah meninggalkan separuh objek
-- terbentuk lalu MEMBLOKIR seluruh deploy berikutnya. Enum berpenjaga pg_type,
-- tabel & indeks pakai IF NOT EXISTS, constraint dijatuhkan dulu sebelum
-- dipasang ulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportKind') THEN
    CREATE TYPE "ImportKind" AS ENUM ('rab', 'jadwal', 'master_lokasi', 'laporan_harian', 'dokumen_drive');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportStatus') THEN
    CREATE TYPE "ImportStatus" AS ENUM ('diproses', 'berhasil', 'sebagian', 'gagal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImportIssueSeverity') THEN
    CREATE TYPE "ImportIssueSeverity" AS ENUM ('tolak', 'peringatan');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "import_jobs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID,
    "location_id" UUID,
    "package_id" UUID,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'diproses',
    "file_name" TEXT NOT NULL,
    "file_bytes" INTEGER NOT NULL DEFAULT 0,
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "rows_accepted" INTEGER NOT NULL DEFAULT 0,
    "rows_rejected" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "import_issues" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "severity" "ImportIssueSeverity" NOT NULL,
    "row_number" INTEGER,
    "column" TEXT,
    "value" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "import_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_jobs_org_id_started_at_idx" ON "import_jobs"("org_id", "started_at");
CREATE INDEX IF NOT EXISTS "import_jobs_kind_started_at_idx" ON "import_jobs"("kind", "started_at");
CREATE INDEX IF NOT EXISTS "import_jobs_location_id_started_at_idx" ON "import_jobs"("location_id", "started_at");
CREATE INDEX IF NOT EXISTS "import_issues_job_id_severity_idx" ON "import_issues"("job_id", "severity");

ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS "import_jobs_org_id_fkey";
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS "import_jobs_user_id_fkey";
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS "import_jobs_location_id_fkey";
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS "import_jobs_package_id_fkey";
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_issues" DROP CONSTRAINT IF EXISTS "import_issues_job_id_fkey";
ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
