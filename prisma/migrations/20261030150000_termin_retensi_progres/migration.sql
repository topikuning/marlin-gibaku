-- Retensi per termin dan progres menurut laporan konsultan (DECISIONS 717).
-- Idempoten (DECISIONS 167): aman dijalankan ulang.

ALTER TABLE "contract_termin" ADD COLUMN IF NOT EXISTS "retensi_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "termin_progres_konsultan" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "termin_ke" INTEGER NOT NULL,
    "progres_pct" DECIMAL(6,3) NOT NULL,
    "minggu_ke" INTEGER NOT NULL,
    "lokasi" JSONB NOT NULL DEFAULT '[]',
    "diubah_oleh_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "termin_progres_konsultan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "termin_progres_konsultan_contract_id_termin_ke_key"
  ON "termin_progres_konsultan"("contract_id", "termin_ke");
ALTER TABLE "termin_progres_konsultan" DROP CONSTRAINT IF EXISTS "termin_progres_konsultan_contract_id_fkey";
ALTER TABLE "termin_progres_konsultan" ADD CONSTRAINT "termin_progres_konsultan_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "termin_progres_konsultan" DROP CONSTRAINT IF EXISTS "termin_progres_konsultan_diubah_oleh_id_fkey";
ALTER TABLE "termin_progres_konsultan" ADD CONSTRAINT "termin_progres_konsultan_diubah_oleh_id_fkey"
  FOREIGN KEY ("diubah_oleh_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
