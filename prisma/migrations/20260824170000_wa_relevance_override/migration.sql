-- Kurasi relevansi manual pesan chat grup (rombak UI 2026-08-24). Idempoten.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaRelevanceOverride') THEN
    CREATE TYPE "WaRelevanceOverride" AS ENUM ('relevan', 'diabaikan');
  END IF;
END
$$;

ALTER TABLE "wa_messages" ADD COLUMN IF NOT EXISTS "relevance_override" "WaRelevanceOverride";
