-- ANALISA AI PER URAIAN (DECISIONS 807). Idempoten: aman dijalankan ulang.
ALTER TABLE "rapl_analisa_ai" ADD COLUMN IF NOT EXISTS "tanda" TEXT;
CREATE INDEX IF NOT EXISTS "rapl_analisa_ai_tanda_status_idx" ON "rapl_analisa_ai"("tanda", "status");
