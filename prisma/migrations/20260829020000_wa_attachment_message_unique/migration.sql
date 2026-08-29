-- SATU pesan = SATU lampiran, ditegakkan basis data.
--
-- Penjaga di `ingest.ts` (findFirst lalu create) hanya menutup pengulangan
-- webhook yang BERURUTAN. Dua webhook bersamaan bisa sama-sama belum menemukan
-- barisnya lalu sama-sama membuat — dan indeks biasa tidak menahan apa pun.
--
-- Baris kembar yang sudah terlanjur ada dibersihkan lebih dulu: yang tertua
-- dipertahankan, karena ketetapan manusia (bila sudah ada) menempel padanya.
--
-- Pembandingnya sepasang (created_at, id), bukan created_at saja. Dua webhook
-- yang ditangani dalam satu transaksi memperoleh `now()` yang PERSIS sama, dan
-- perbandingan created_at saja tidak menyisihkan satu pun dari keduanya —
-- pembuatan indeks unik di bawah lalu GAGAL dan seluruh deploy ikut gagal.
-- Pasangan dengan id sebagai pemutus selalu menyisakan tepat satu baris.
DELETE FROM "wa_attachments" a
USING "wa_attachments" b
WHERE a."message_id" = b."message_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");

DROP INDEX IF EXISTS "wa_attachments_message_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "wa_attachments_message_id_key" ON "wa_attachments"("message_id");
