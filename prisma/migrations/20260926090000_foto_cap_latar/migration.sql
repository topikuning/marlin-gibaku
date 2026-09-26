-- DECISIONS 618: cap foto dikerjakan di latar setelah berkas asli tersimpan.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "stamp_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "stamp_tries" INTEGER NOT NULL DEFAULT 0;
