-- Draf harga AI berhenti hidup di memori peramban dan berhenti menahan request
-- (RAPL-01/RAPL-02/RAPL-06, DECISIONS 470). Idempoten: DECISIONS 167.

CREATE TABLE IF NOT EXISTS "hsd_usulan_run" (
  "id"              UUID         NOT NULL,
  "location_id"     UUID         NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'menunggu',
  "pending_since"   TIMESTAMPTZ,
  "model"           TEXT,
  "error_message"   TEXT,
  "diminta"         INTEGER      NOT NULL DEFAULT 0,
  "total_kosong"    INTEGER      NOT NULL DEFAULT 0,
  "requested_by_id" UUID         NOT NULL,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selesai_at"      TIMESTAMPTZ,
  CONSTRAINT "hsd_usulan_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hsd_usulan_ai" (
  "id"         UUID        NOT NULL,
  "run_id"     UUID        NOT NULL,
  "kategori"   TEXT        NOT NULL,
  "nama"       TEXT        NOT NULL,
  "satuan"     TEXT        NOT NULL,
  "harga"      BIGINT      NOT NULL,
  "keyakinan"  TEXT        NOT NULL,
  "alasan"     TEXT        NOT NULL,
  "status"     TEXT        NOT NULL DEFAULT 'draf',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hsd_usulan_ai_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hsd_usulan_run_location_id_created_at_idx"
  ON "hsd_usulan_run" ("location_id", "created_at");
CREATE INDEX IF NOT EXISTS "hsd_usulan_run_pending_since_idx"
  ON "hsd_usulan_run" ("pending_since");
CREATE UNIQUE INDEX IF NOT EXISTS "hsd_usulan_ai_run_id_kategori_nama_satuan_key"
  ON "hsd_usulan_ai" ("run_id", "kategori", "nama", "satuan");
CREATE INDEX IF NOT EXISTS "hsd_usulan_ai_run_id_status_idx"
  ON "hsd_usulan_ai" ("run_id", "status");

ALTER TABLE "hsd_usulan_run"
  DROP CONSTRAINT IF EXISTS "hsd_usulan_run_location_id_fkey";
ALTER TABLE "hsd_usulan_run"
  ADD CONSTRAINT "hsd_usulan_run_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hsd_usulan_run"
  DROP CONSTRAINT IF EXISTS "hsd_usulan_run_requested_by_id_fkey";
ALTER TABLE "hsd_usulan_run"
  ADD CONSTRAINT "hsd_usulan_run_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hsd_usulan_ai"
  DROP CONSTRAINT IF EXISTS "hsd_usulan_ai_run_id_fkey";
ALTER TABLE "hsd_usulan_ai"
  ADD CONSTRAINT "hsd_usulan_ai_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "hsd_usulan_run" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
