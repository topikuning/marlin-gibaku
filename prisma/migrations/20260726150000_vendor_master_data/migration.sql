-- Master data perusahaan (vendor): alamat/telepon/email + logo (kop surat) — DECISIONS 134
ALTER TABLE "vendors" ADD COLUMN "address" TEXT;
ALTER TABLE "vendors" ADD COLUMN "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "email" TEXT;
ALTER TABLE "vendors" ADD COLUMN "logo_key" TEXT;
