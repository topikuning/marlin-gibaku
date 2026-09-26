-- DECISIONS 619: letak tulisan lama di foto, untuk tata letak cap yang menghindarinya.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "text_boxes" JSONB;
