-- Jejak pengiriman pengingat harian (DECISIONS 207).
--
-- "terkirim" tanpa jejak tidak bisa ditelusuri saat pesannya tidak sampai:
-- ke nomor mana, berapa kali, jam berapa. Idempoten (DECISIONS 167/176).
ALTER TABLE "daily_reminder_logs" ADD COLUMN IF NOT EXISTS "chat_id" TEXT;
ALTER TABLE "daily_reminder_logs" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "daily_reminder_logs" ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMPTZ;
