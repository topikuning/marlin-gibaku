-- Arsip pesan grup WhatsApp (inbound via webhook WAHA) — fondasi integrasi AI.
CREATE TABLE "wa_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_id" UUID,
    "chat_id" TEXT NOT NULL,
    "wa_message_id" TEXT NOT NULL,
    "from_number" TEXT,
    "from_name" TEXT,
    "body" TEXT NOT NULL,
    "has_media" BOOLEAN NOT NULL DEFAULT false,
    "media_type" TEXT,
    "from_me" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wa_messages_wa_message_id_key" ON "wa_messages"("wa_message_id");
CREATE INDEX "wa_messages_package_id_timestamp_idx" ON "wa_messages"("package_id", "timestamp");
CREATE INDEX "wa_messages_chat_id_timestamp_idx" ON "wa_messages"("chat_id", "timestamp");

ALTER TABLE "wa_messages"
    ADD CONSTRAINT "wa_messages_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
