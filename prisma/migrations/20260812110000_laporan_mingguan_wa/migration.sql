-- Jejak kirim LAPORAN PROGRES MINGGUAN ke grup WhatsApp paket (DECISIONS 311).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

CREATE TABLE IF NOT EXISTS "weekly_wa_logs" (
    "id"            UUID         NOT NULL,
    "package_id"    UUID         NOT NULL,
    "week_number"   INTEGER      NOT NULL,
    "locations"     INTEGER      NOT NULL,
    "status"        TEXT         NOT NULL,
    "error"         TEXT,
    "wa_message_id" TEXT,
    "chat_id"       TEXT,
    "manual"        BOOLEAN      NOT NULL DEFAULT false,
    "body"          TEXT         NOT NULL,
    "sent_by_id"    UUID,
    "attempts"      INTEGER      NOT NULL DEFAULT 1,
    "last_sent_at"  TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_wa_logs_pkey" PRIMARY KEY ("id")
);

-- Kunci utama pengaman "satu minggu kontrak diumumkan sekali". Cron berjalan
-- tiap hari dan aman dipicu berulang justru karena batasan ini, bukan karena
-- penjadwal luarnya tepat waktu.
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_wa_logs_package_id_week_number_key"
    ON "weekly_wa_logs" ("package_id", "week_number");

CREATE INDEX IF NOT EXISTS "weekly_wa_logs_created_at_idx"
    ON "weekly_wa_logs" ("created_at");

ALTER TABLE "weekly_wa_logs" DROP CONSTRAINT IF EXISTS "weekly_wa_logs_package_id_fkey";
ALTER TABLE "weekly_wa_logs" ADD CONSTRAINT "weekly_wa_logs_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
