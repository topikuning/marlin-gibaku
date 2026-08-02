-- Catatan izin perangkat (GPS & kamera) — DECISIONS 219.
-- Append-only: izin browser melekat ke perangkat, bisa dicabut, dan user lazim
-- berganti HP; satu kolom "sudah izin" akan berbohong begitu itu terjadi.
CREATE TABLE IF NOT EXISTS "device_permissions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"        TEXT NOT NULL,
  "state"       TEXT NOT NULL,
  "user_agent"  TEXT,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "device_permissions_user_id_kind_recorded_at_idx"
  ON "device_permissions" ("user_id", "kind", "recorded_at");
