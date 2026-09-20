-- LAPORAN MINGGUAN DIKUNCI PER GRUP, BUKAN PER PAKET (DECISIONS 596)
--
-- `UNIQUE (package_id, week_number)` berarti satu paket hanya boleh satu
-- kiriman per minggu. Paket dengan dua grup kabupaten berhak atas dua kiriman —
-- satu per kabupaten — dan kunci lama akan menganggap kiriman kedua sebagai
-- pengulangan lalu menolaknya diam-diam.
--
-- Idempoten (DECISIONS 167).

ALTER TABLE "weekly_wa_logs" ADD COLUMN IF NOT EXISTS "target_chat_id" TEXT;

-- Baris lama ditulisi grup paketnya; `chat_id` dipakai lebih dulu karena ia
-- merekam grup yang BENAR-BENAR dituju saat itu — lebih jujur daripada grup
-- paket hari ini, yang bisa sudah diganti sejak.
UPDATE "weekly_wa_logs" w
   SET "target_chat_id" = COALESCE(w."chat_id", p."wa_group_id", 'paket:' || w."package_id"::text)
  FROM "packages" p
 WHERE p."id" = w."package_id"
   AND w."target_chat_id" IS NULL;

UPDATE "weekly_wa_logs"
   SET "target_chat_id" = COALESCE("chat_id", 'paket:' || "package_id"::text)
 WHERE "target_chat_id" IS NULL;

ALTER TABLE "weekly_wa_logs" ALTER COLUMN "target_chat_id" SET NOT NULL;

DROP INDEX IF EXISTS "weekly_wa_logs_package_id_week_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_wa_logs_week_number_target_chat_id_key"
  ON "weekly_wa_logs" ("week_number", "target_chat_id");
CREATE INDEX IF NOT EXISTS "weekly_wa_logs_package_id_week_number_idx"
  ON "weekly_wa_logs" ("package_id", "week_number");
