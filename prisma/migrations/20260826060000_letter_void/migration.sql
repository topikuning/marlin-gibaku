-- Pembatalan surat (DECISIONS 437): reversibel, ber-alasan, tetap tercatat.
-- Idempoten: nilai enum & kolom dipasang dengan IF NOT EXISTS.
ALTER TYPE "LetterStatus" ADD VALUE IF NOT EXISTS 'dibatalkan';

ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "voided_by_id" UUID;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "void_reason" TEXT;
