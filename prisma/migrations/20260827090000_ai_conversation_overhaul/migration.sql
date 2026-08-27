ALTER TABLE "wa_chat_contexts"
ADD COLUMN IF NOT EXISTS "history" JSONB;

ALTER TABLE "wa_chat_contexts"
ALTER COLUMN "niat" DROP NOT NULL;
