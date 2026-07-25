-- Penanda kiriman laporan harian ke grup WhatsApp.
ALTER TABLE "daily_reports" ADD COLUMN "wa_sent_at" TIMESTAMPTZ;
ALTER TABLE "daily_reports" ADD COLUMN "wa_sent_by_id" UUID;
