-- AlterTable
ALTER TABLE "wa_messages" ADD COLUMN     "sender_jid" TEXT;

-- CreateTable
CREATE TABLE "wa_sender_aliases" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "sender_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wa_sender_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wa_sender_aliases_org_id_sender_key_key" ON "wa_sender_aliases"("org_id", "sender_key");

