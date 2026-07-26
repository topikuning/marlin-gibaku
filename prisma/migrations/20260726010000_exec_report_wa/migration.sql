-- Laporan Eksekutif → WA: kontak per-pembuat + histori kirim. DECISIONS 122.
CREATE TABLE "wa_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "wa_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wa_contacts_owner_id_idx" ON "wa_contacts"("owner_id");

CREATE TABLE "report_dispatches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "report_key" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "dest_name" TEXT NOT NULL,
    "dest_chat_id" TEXT NOT NULL,
    "provider" TEXT,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "report_dispatches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_dispatches_sender_id_created_at_idx" ON "report_dispatches"("sender_id", "created_at");
