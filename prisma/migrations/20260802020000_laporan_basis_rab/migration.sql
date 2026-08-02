-- Basis RAB tiap baris laporan harian (DECISIONS 210).
--
-- `aktif` = RAB kontrak yang berlaku; `draft_adendum` = RAB pengajuan adendum
-- yang belum resmi. Baris lama semuanya `aktif` — itu memang keadaannya.
-- Idempoten (DECISIONS 167/176).
ALTER TABLE "daily_report_items" ADD COLUMN IF NOT EXISTS "basis" TEXT NOT NULL DEFAULT 'aktif';
CREATE INDEX IF NOT EXISTS "daily_report_items_basis_idx" ON "daily_report_items" ("basis");
