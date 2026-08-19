-- KLARIFIKASI TERTUNDA per chat + PENGIRIM (DECISIONS 376).
--
-- Idempoten sepenuhnya: migrasi ini harus aman dijalankan ulang setelah deploy
-- yang gagal di tengah jalan (lihat DECISIONS 373 — `migrate deploy` yang
-- berhenti separuh jalan meninggalkan migrasi bertanda gagal, dan pemulihannya
-- mengulang berkas yang sama).

CREATE TABLE IF NOT EXISTS "wa_pending_clarifications" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "chat_id"          TEXT         NOT NULL,
  "sender_key"       TEXT         NOT NULL,
  "pertanyaan"       TEXT         NOT NULL,
  "kandidat"         JSONB        NOT NULL,
  "wa_message_id"    TEXT         NOT NULL,
  "offer_message_id" TEXT,
  "expires_at"       TIMESTAMPTZ  NOT NULL,
  "answered_at"      TIMESTAMPTZ,
  "pilihan"          INTEGER,
  "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "wa_pending_clarifications_pkey" PRIMARY KEY ("id")
);

-- Satu tawaran aktif per orang per chat. Tanpa indeks ini, tawaran menumpuk dan
-- balasan "1" menjadi taruhan tentang tawaran mana yang dimaksud.
CREATE UNIQUE INDEX IF NOT EXISTS "wa_pending_clarifications_chat_id_sender_key_key"
  ON "wa_pending_clarifications" ("chat_id", "sender_key");

CREATE INDEX IF NOT EXISTS "wa_pending_clarifications_expires_at_idx"
  ON "wa_pending_clarifications" ("expires_at");
