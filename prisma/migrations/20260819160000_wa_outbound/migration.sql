-- OUTBOX kiriman WhatsApp + rekonsiliasi message.ack (DECISIONS 374).
--
-- Sebelumnya tiap pemanggil menafsirkan keberhasilan sendiri, dan sebagian UI
-- menulis "Terkirim" begitu HTTP 2xx — padahal WAHA menjawab 2xx juga saat
-- sesinya belum login, dan pesannya tidak pernah keluar.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaOutboundKind') THEN
    CREATE TYPE "WaOutboundKind" AS ENUM ('teks', 'gambar', 'berkas');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaOutboundStatus') THEN
    CREATE TYPE "WaOutboundStatus" AS ENUM
      ('antre', 'diterima_waha', 'terkirim', 'sampai', 'dibaca', 'gagal', 'ditolak');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wa_outbound" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"            "WaOutboundKind"   NOT NULL,
  "chat_id"         TEXT               NOT NULL,
  "idempotency_key" TEXT               NOT NULL,
  "source_type"     TEXT               NOT NULL,
  "source_id"       TEXT,
  "wa_message_id"   TEXT,
  "status"          "WaOutboundStatus" NOT NULL DEFAULT 'antre',
  "attempts"        INTEGER            NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "error_code"      TEXT,
  "ringkas"         TEXT,
  "sent_at"         TIMESTAMPTZ,
  "ack_at"          TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ        NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_outbound_idempotency_key_key"
  ON "wa_outbound" ("idempotency_key");

-- Ack dicocokkan lewat ID pesan WAHA; harus unik supaya satu ack tidak pernah
-- menyentuh dua baris.
CREATE UNIQUE INDEX IF NOT EXISTS "wa_outbound_wa_message_id_key"
  ON "wa_outbound" ("wa_message_id");

CREATE INDEX IF NOT EXISTS "wa_outbound_status_created_at_idx"
  ON "wa_outbound" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "wa_outbound_source_type_source_id_idx"
  ON "wa_outbound" ("source_type", "source_id");
