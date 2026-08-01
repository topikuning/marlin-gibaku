-- Bukti pengiriman pengingat: ID pesan dari WAHA (DECISIONS 206).
--
-- Tanpa kolom ini, status "sukses" cuma berarti server WAHA menjawab 2xx —
-- dan itu TETAP terjadi saat sesi WhatsApp belum login, sehingga sistem
-- melaporkan "7 terkirim" padahal tidak ada satu pun pesan yang keluar.
--
-- Idempoten (DECISIONS 167/176).
ALTER TABLE "daily_reminder_logs" ADD COLUMN IF NOT EXISTS "wa_message_id" TEXT;
