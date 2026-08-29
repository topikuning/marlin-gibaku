-- Antrean pengingat laporan harian ke GRUP WhatsApp paket.
--
-- Jeda antar grup minimal satu menit, jadi 19 paket berjalan = ±19 menit —
-- tidak muat di satu putaran route (maxDuration 300 detik). Barisnya dibuat
-- sekaligus dengan `send_after` bertingkat, lalu dikuras putaran berikutnya.
--
-- UNIQUE (package_id, date_key): penjadwal yang dipicu dua kali sehari tidak
-- boleh membuat giliran kedua untuk grup yang sama.
CREATE TABLE IF NOT EXISTS "wa_group_reminders" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "package_id"    UUID NOT NULL,
  "date_key"      TEXT NOT NULL,
  "send_after"    TIMESTAMPTZ NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'menunggu',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "locations"     INTEGER NOT NULL DEFAULT 0,
  "wa_message_id" TEXT,
  "chat_id"       TEXT,
  "last_error"    TEXT,
  "sent_at"       TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_group_reminders_package_id_date_key_key"
  ON "wa_group_reminders"("package_id", "date_key");

CREATE INDEX IF NOT EXISTS "wa_group_reminders_status_send_after_idx"
  ON "wa_group_reminders"("status", "send_after");

ALTER TABLE "wa_group_reminders"
  DROP CONSTRAINT IF EXISTS "wa_group_reminders_package_id_fkey";
ALTER TABLE "wa_group_reminders"
  ADD CONSTRAINT "wa_group_reminders_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
