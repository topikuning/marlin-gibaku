-- PENGINGAT HARIAN DIKUNCI PER GRUP, BUKAN PER PAKET (DECISIONS 596)
--
-- `UNIQUE (package_id, date_key)` berarti satu paket hanya boleh punya SATU
-- giliran per hari. Begitu paket itu punya dua grup kabupaten, grup pertama
-- dikirimi dan grup kedua TIDAK PERNAH menerima apa pun — bukan galat, bukan
-- baris gagal, tidak ada jejak apa pun yang bisa dilaporkan orang.
--
-- Kunci barunya `(date_key, target_chat_id)` menyatakan aturan yang sebenarnya:
-- satu pengingat per GRUP per hari. Ia sekaligus menutup arah sebaliknya, dua
-- pesan ke satu grup dalam sehari.
--
-- Idempoten (DECISIONS 167).

ALTER TABLE "wa_group_reminders" ADD COLUMN IF NOT EXISTS "target_chat_id" TEXT;

-- Baris lama ditulisi grup paketnya. Yang paketnya sudah tidak punya grup
-- (dilepas sesudah barisnya dibuat) diberi penanda ber-awalan `paket:` supaya
-- tetap unik dan tetap terbaca sebagai riwayat — BUKAN dihapus: baris pengingat
-- adalah jejak bahwa tagihan pernah dikirim, dan membuangnya menghapus bukti.
UPDATE "wa_group_reminders" r
   SET "target_chat_id" = COALESCE(p."wa_group_id", 'paket:' || r."package_id"::text)
  FROM "packages" p
 WHERE p."id" = r."package_id"
   AND r."target_chat_id" IS NULL;

-- Jaring untuk baris yang paketnya sudah hilang sama sekali.
UPDATE "wa_group_reminders"
   SET "target_chat_id" = 'paket:' || "package_id"::text
 WHERE "target_chat_id" IS NULL;

ALTER TABLE "wa_group_reminders" ALTER COLUMN "target_chat_id" SET NOT NULL;

DROP INDEX IF EXISTS "wa_group_reminders_package_id_date_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "wa_group_reminders_date_key_target_chat_id_key"
  ON "wa_group_reminders" ("date_key", "target_chat_id");
