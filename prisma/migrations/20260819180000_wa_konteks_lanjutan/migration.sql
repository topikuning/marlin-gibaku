-- KONTEKS PERTANYAAN TERAKHIR untuk pertanyaan susulan (DECISIONS 377).
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

CREATE TABLE IF NOT EXISTS "wa_chat_contexts" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "chat_id"        TEXT        NOT NULL,
  "sender_key"     TEXT        NOT NULL,
  "niat"           TEXT        NOT NULL,
  "lokasi_disebut" JSONB       NOT NULL,
  "expires_at"     TIMESTAMPTZ NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wa_chat_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_chat_contexts_chat_id_sender_key_key"
  ON "wa_chat_contexts" ("chat_id", "sender_key");

CREATE INDEX IF NOT EXISTS "wa_chat_contexts_expires_at_idx"
  ON "wa_chat_contexts" ("expires_at");
