-- Siapa yang meminta kiriman WhatsApp (DECISIONS baru 2026-10-07).

ALTER TABLE "wa_outbound" ADD COLUMN IF NOT EXISTS "diminta_oleh_id" UUID;
ALTER TABLE "wa_outbound" ADD COLUMN IF NOT EXISTS "peminta" TEXT;

CREATE INDEX IF NOT EXISTS "wa_outbound_diminta_oleh_id_idx" ON "wa_outbound"("diminta_oleh_id");

ALTER TABLE "wa_outbound" DROP CONSTRAINT IF EXISTS "wa_outbound_diminta_oleh_id_fkey";
ALTER TABLE "wa_outbound" ADD CONSTRAINT "wa_outbound_diminta_oleh_id_fkey" FOREIGN KEY ("diminta_oleh_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
