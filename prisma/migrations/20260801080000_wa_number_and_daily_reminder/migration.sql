-- Nomor WA pengguna + catatan pengingat laporan harian (DECISIONS 202).
--
-- `daily_reminder_logs` bukan sekadar log: UNIQUE (user_id, date_key) adalah
-- KUNCI IDEMPOTENSI penjadwal. Cron bisa dipicu ulang (retry, dua instance,
-- klik manual) — percobaan kedua di hari yang sama menabrak unique dan tidak
-- mengirim pesan dobel ke lapangan.
--
-- Idempoten (DECISIONS 167/176): kolom & tabel pakai IF NOT EXISTS.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wa_number" TEXT;

CREATE TABLE IF NOT EXISTS "daily_reminder_logs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "date_key" TEXT NOT NULL,
  "locations" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_reminder_logs_user_id_date_key_key"
  ON "daily_reminder_logs" ("user_id", "date_key");
CREATE INDEX IF NOT EXISTS "daily_reminder_logs_date_key_idx"
  ON "daily_reminder_logs" ("date_key");

-- Tindakan OTOMATIS tidak boleh diatribusikan ke manusia. Aktivasi SPMK
-- terjadwal dijalankan sistem, jadi kolom pelakunya harus boleh kosong —
-- mengisinya dengan user mana pun akan memalsukan siapa yang bertindak.
-- ALTER ... DROP NOT NULL idempoten by nature.
ALTER TABLE "location_status_history" ALTER COLUMN "changed_by_id" DROP NOT NULL;
ALTER TABLE "package_stage_history" ALTER COLUMN "changed_by_id" DROP NOT NULL;
