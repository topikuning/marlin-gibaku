ALTER TABLE "documents" ADD COLUMN "prospek_id" UUID;
CREATE INDEX "documents_prospek_id_idx" ON "documents"("prospek_id");
