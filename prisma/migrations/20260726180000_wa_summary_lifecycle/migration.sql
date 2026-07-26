-- CreateEnum
CREATE TYPE "WaChatSummaryStatus" AS ENUM ('draft_ai', 'edited_draft', 'final', 'sent');

-- AlterTable
ALTER TABLE "wa_chat_summaries" ADD COLUMN     "ai_text" TEXT,
ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "dispatches" JSONB,
ADD COLUMN     "edited_at" TIMESTAMPTZ,
ADD COLUMN     "edited_by_id" UUID,
ADD COLUMN     "excluded_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finalized_at" TIMESTAMPTZ,
ADD COLUMN     "finalized_by_id" UUID,
ADD COLUMN     "generated_at" TIMESTAMPTZ,
ADD COLUMN     "generated_by_id" UUID,
ADD COLUMN     "last_sent_at" TIMESTAMPTZ,
ADD COLUMN     "marlin_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "WaChatSummaryStatus" NOT NULL DEFAULT 'draft_ai',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

