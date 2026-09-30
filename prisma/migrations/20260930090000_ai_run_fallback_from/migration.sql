-- DECISIONS 635: provider UTAMA yang gagal sehingga jawaban datang dari cadangan.
ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "fallback_from" TEXT;
