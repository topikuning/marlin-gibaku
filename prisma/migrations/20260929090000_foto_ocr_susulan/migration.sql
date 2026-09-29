-- DECISIONS 628: tag bawaan foto yang belum terbaca OCR, dibaca susulan di latar.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "ocr_pending" BOOLEAN NOT NULL DEFAULT false;
