-- Sesi lapor lewat WhatsApp pribadi (DECISIONS 706).
-- Idempoten (DECISIONS 167): aman dijalankan ulang.
CREATE TABLE IF NOT EXISTS "wa_lapor_sesi" (
    "user_id" UUID NOT NULL,
    "chat_id" TEXT NOT NULL,
    "location_id" UUID,
    "lineage_key" TEXT,
    "tawaran" JSONB,
    "foto_menunggu" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rapel_tersimpan" INTEGER NOT NULL DEFAULT 0,
    "rapel_ditempel" INTEGER NOT NULL DEFAULT 0,
    "rapel_tanpa_gps" INTEGER NOT NULL DEFAULT 0,
    "foto_tersimpan" INTEGER NOT NULL DEFAULT 0,
    "catatan_gps_dikirim" BOOLEAN NOT NULL DEFAULT false,
    "mulai_at" TIMESTAMPTZ NOT NULL,
    "terakhir_at" TIMESTAMPTZ NOT NULL,
    "selesai_at" TIMESTAMPTZ,
    CONSTRAINT "wa_lapor_sesi_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "wa_lapor_sesi" DROP CONSTRAINT IF EXISTS "wa_lapor_sesi_user_id_fkey";
ALTER TABLE "wa_lapor_sesi" ADD CONSTRAINT "wa_lapor_sesi_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_lapor_sesi" DROP CONSTRAINT IF EXISTS "wa_lapor_sesi_location_id_fkey";
ALTER TABLE "wa_lapor_sesi" ADD CONSTRAINT "wa_lapor_sesi_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
