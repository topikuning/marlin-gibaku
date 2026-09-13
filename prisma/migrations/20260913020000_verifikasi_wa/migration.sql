-- VERIFIKASI NOMOR WHATSAPP PENGGUNA (DECISIONS 570).
--
-- Dua arah: pengguna mengirim frasa sekali-pakai DARI nomornya sendiri, lalu
-- mengetikkan kode yang dibalaskan ke sana. Nomor yang diketik orang di layar
-- tidak pernah menghasilkan cap terverifikasi — yang diketik cuma klaim, dan
-- salah ketik satu angka berarti laporan orang ini dikirim ke nomor orang lain.
--
-- `IF NOT EXISTS` bukan kerapian melainkan syarat (DECISIONS 167): Prisma
-- menjalankan migrasi satu pernyataan per pernyataan, BUKAN dalam satu
-- transaksi, jadi migrasi yang mati di tengah harus aman diulang.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "wa_verified_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "wa_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phrase" TEXT NOT NULL,
    "code" TEXT,
    "sender_key" TEXT,
    "wa_number" TEXT,
    "wa_lid" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "wa_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_verifications_user_id_key" ON "wa_verifications"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wa_verifications_phrase_key" ON "wa_verifications"("phrase");
CREATE INDEX IF NOT EXISTS "wa_verifications_expires_at_idx" ON "wa_verifications"("expires_at");

ALTER TABLE "wa_verifications" DROP CONSTRAINT IF EXISTS "wa_verifications_user_id_fkey";
ALTER TABLE "wa_verifications" ADD CONSTRAINT "wa_verifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
