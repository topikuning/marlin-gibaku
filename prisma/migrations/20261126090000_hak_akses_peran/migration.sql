-- DECISIONS 793: hak akses per peran yang diatur Super Admin dari layar Sistem.
-- Hanya selisih dari bawaan kode; jenjang & sel terkunci dijaga kode.
CREATE TABLE IF NOT EXISTS "hak_akses_peran" (
  "role" "UserRole" NOT NULL,
  "capability" TEXT NOT NULL,
  "boleh" BOOLEAN NOT NULL,
  "diubah_oleh_id" UUID NOT NULL,
  "diubah_pada" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hak_akses_peran_pkey" PRIMARY KEY ("role", "capability")
);
