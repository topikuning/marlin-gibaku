-- Integrasi WhatsApp (WAHA): grup per paket + penanda kiriman kegiatan.
ALTER TABLE "packages" ADD COLUMN "wa_group_id" TEXT;
ALTER TABLE "packages" ADD COLUMN "wa_group_name" TEXT;

ALTER TABLE "field_activities" ADD COLUMN "wa_sent_at" TIMESTAMPTZ;
ALTER TABLE "field_activities" ADD COLUMN "wa_sent_by_id" UUID;
