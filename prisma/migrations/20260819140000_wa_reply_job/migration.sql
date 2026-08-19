-- ANTREAN JAWABAN WHATSAPP (DECISIONS 372).
--
-- Webhook menaruh pekerjaan di sini lalu langsung mengembalikan 200; processor
-- yang menjalankan AI dan pengiriman. Kunci idempotensinya `wa_message_id`
-- UNIQUE: satu pesan masuk hanya melahirkan SATU pekerjaan jawab, berapa pun
-- kali WAHA mengirim ulang event yang sama.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaJobStatus') THEN
    CREATE TYPE "WaJobStatus" AS ENUM ('antre', 'berjalan', 'selesai', 'gagal');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wa_reply_jobs" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "wa_message_id"   TEXT        NOT NULL,
  "chat_id"         TEXT        NOT NULL,
  "payload"         JSONB       NOT NULL,
  "status"          "WaJobStatus" NOT NULL DEFAULT 'antre',
  "attempts"        INTEGER     NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at"      TIMESTAMPTZ,
  "finished_at"     TIMESTAMPTZ,
  "hasil"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_reply_jobs_wa_message_id_key"
  ON "wa_reply_jobs" ("wa_message_id");

-- Antrean dibaca dengan pola yang sama setiap kali: yang ANTRE dan sudah waktunya.
CREATE INDEX IF NOT EXISTS "wa_reply_jobs_status_next_attempt_at_idx"
  ON "wa_reply_jobs" ("status", "next_attempt_at");
