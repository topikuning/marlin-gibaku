-- Tanya AI tidak lagi ditahan di dalam request HTTP (DECISIONS 455).
-- Percakapan menandai sendiri kapan ia sedang menunggu jawaban.
ALTER TABLE "ai_conversations"
ADD COLUMN IF NOT EXISTS "pending_since" TIMESTAMPTZ;
