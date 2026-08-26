-- Penangkap lampiran grup WA (DECISIONS 432). Idempoten: enum berpenjaga
-- pg_type, tabel & indeks IF NOT EXISTS, constraint didahului DROP IF EXISTS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaAttachmentStatus') THEN
    CREATE TYPE "WaAttachmentStatus" AS ENUM ('tertangkap', 'dilewati', 'gagal');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaAttachmentKind') THEN
    CREATE TYPE "WaAttachmentKind" AS ENUM ('foto_lapangan', 'dokumen', 'surat_kandidat', 'media_lain', 'abaikan');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaAttachmentDecision') THEN
    CREATE TYPE "WaAttachmentDecision" AS ENUM ('belum', 'jadi_surat', 'jadi_dokumen', 'bukan_apa_apa');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "wa_attachments" (
  "id"            UUID PRIMARY KEY,
  "message_id"    UUID NOT NULL,
  "package_id"    UUID,
  "file_name"     TEXT,
  "mime_type"     TEXT,
  "size_bytes"    INTEGER,
  "sha256"        TEXT,
  "local_path"    TEXT,
  "r2_key"        TEXT,
  "status"        "WaAttachmentStatus" NOT NULL DEFAULT 'tertangkap',
  "fail_reason"   TEXT,
  "saran_kind"    "WaAttachmentKind" NOT NULL DEFAULT 'media_lain',
  "saran_alasan"  TEXT,
  "saran_ringkas" TEXT,
  "decision"      "WaAttachmentDecision" NOT NULL DEFAULT 'belum',
  "decided_by_id" UUID,
  "decided_at"    TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "wa_attachments" DROP CONSTRAINT IF EXISTS "wa_attachments_message_id_fkey";
ALTER TABLE "wa_attachments" ADD CONSTRAINT "wa_attachments_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "wa_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_attachments" DROP CONSTRAINT IF EXISTS "wa_attachments_package_id_fkey";
ALTER TABLE "wa_attachments" ADD CONSTRAINT "wa_attachments_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "wa_attachments_package_id_created_at_idx" ON "wa_attachments"("package_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_attachments_decision_saran_kind_idx" ON "wa_attachments"("decision", "saran_kind");
CREATE INDEX IF NOT EXISTS "wa_attachments_sha256_idx" ON "wa_attachments"("sha256");
