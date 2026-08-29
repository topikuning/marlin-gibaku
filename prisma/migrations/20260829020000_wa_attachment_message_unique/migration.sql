-- SATU pesan = SATU lampiran, ditegakkan basis data.
--
-- Penjaga di `ingest.ts` (findFirst lalu create) hanya menutup pengulangan
-- webhook yang BERURUTAN. Dua webhook bersamaan bisa sama-sama belum menemukan
-- barisnya lalu sama-sama membuat — dan indeks biasa tidak menahan apa pun.
--
-- Baris kembar yang sudah terlanjur ada dibersihkan lebih dulu: yang tertua
-- dipertahankan, karena ketetapan manusia (bila sudah ada) menempel padanya.
DELETE FROM "wa_attachments" a
USING "wa_attachments" b
WHERE a."message_id" = b."message_id"
  AND a."created_at" > b."created_at";

DROP INDEX IF EXISTS "wa_attachments_message_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "wa_attachments_message_id_key" ON "wa_attachments"("message_id");
