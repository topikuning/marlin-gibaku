-- Surat berkop penyedia (DECISIONS 716): rekening per kontrak, jadwal termin
-- SSKK, pola nomor surat perusahaan, dan isian surat yang disimpan.
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "bank_nama" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "bank_rekening" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "bank_atas_nama" TEXT;

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "pola_nomor_surat" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "kota_surat" TEXT;

CREATE TABLE IF NOT EXISTS "contract_termin" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "termin_ke" INTEGER NOT NULL,
    "ambang_pct" DECIMAL(5,2) NOT NULL,
    "bayar_pct" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "contract_termin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "contract_termin_contract_id_termin_ke_key" ON "contract_termin"("contract_id", "termin_ke");
ALTER TABLE "contract_termin" DROP CONSTRAINT IF EXISTS "contract_termin_contract_id_fkey";
ALTER TABLE "contract_termin" ADD CONSTRAINT "contract_termin_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JenisSuratPenyedia') THEN
    CREATE TYPE "JenisSuratPenyedia" AS ENUM (
      'permohonan_pemeriksaan', 'ba_pembahasan_kemajuan', 'permohonan_pembayaran', 'invoice', 'kwitansi'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "surat_penyedia" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "jenis" "JenisSuratPenyedia" NOT NULL,
    "termin_ke" INTEGER NOT NULL,
    "nomor" TEXT NOT NULL,
    "nomor_urut" INTEGER,
    "tanggal" DATE NOT NULL,
    "kota" TEXT NOT NULL,
    "isian" JSONB NOT NULL DEFAULT '{}',
    "dibuat_oleh_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "surat_penyedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "surat_penyedia_contract_id_termin_ke_idx" ON "surat_penyedia"("contract_id", "termin_ke");
ALTER TABLE "surat_penyedia" DROP CONSTRAINT IF EXISTS "surat_penyedia_contract_id_fkey";
ALTER TABLE "surat_penyedia" ADD CONSTRAINT "surat_penyedia_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surat_penyedia" DROP CONSTRAINT IF EXISTS "surat_penyedia_dibuat_oleh_id_fkey";
ALTER TABLE "surat_penyedia" ADD CONSTRAINT "surat_penyedia_dibuat_oleh_id_fkey"
  FOREIGN KEY ("dibuat_oleh_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
