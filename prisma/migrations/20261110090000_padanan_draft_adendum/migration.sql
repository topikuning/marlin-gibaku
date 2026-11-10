-- Pemetaan item terlapor ke item draft adendum sebelum aktivasi (DECISIONS 754).
-- Kunci asli item draft sebelum ia mewarisi kunci item kontrak lama; null = kuncinya sendiri.
ALTER TABLE "rab_nodes" ADD COLUMN IF NOT EXISTS "lineage_semula" TEXT;
