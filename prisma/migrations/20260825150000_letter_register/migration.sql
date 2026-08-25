-- Register surat masuk & keluar (DECISIONS 432), tahap 1–4.
-- Idempoten: enum berpenjaga pg_type, ADD COLUMN/CREATE INDEX IF NOT EXISTS,
-- ADD CONSTRAINT selalu didahului DROP CONSTRAINT IF EXISTS.

-- Sumber baru pada enum yang sudah ada (ADD VALUE IF NOT EXISTS = idempoten).
ALTER TYPE "IssueSource" ADD VALUE IF NOT EXISTS 'surat';
ALTER TYPE "FindingSource" ADD VALUE IF NOT EXISTS 'surat';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LetterDirection') THEN
    CREATE TYPE "LetterDirection" AS ENUM ('masuk', 'keluar');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LetterParty') THEN
    CREATE TYPE "LetterParty" AS ENUM ('penyedia', 'wakil_ppk', 'ppk', 'konsultan', 'dinas', 'internal', 'lainnya');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LetterCategory') THEN
    CREATE TYPE "LetterCategory" AS ENUM ('mutu', 'jadwal', 'pembayaran', 'administrasi', 'koordinasi', 'k3', 'lainnya');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LetterStatus') THEN
    CREATE TYPE "LetterStatus" AS ENUM ('baru', 'perlu_jawaban', 'dijawab', 'selesai', 'arsip');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "letters" (
  "id"             UUID PRIMARY KEY,
  "org_id"         UUID NOT NULL,
  "package_id"     UUID,
  "location_id"    UUID,
  "agenda_no"      INTEGER NOT NULL,
  "agenda_year"    INTEGER NOT NULL,
  "direction"      "LetterDirection" NOT NULL,
  "party"          "LetterParty" NOT NULL DEFAULT 'lainnya',
  "party_name"     TEXT,
  "letter_number"  TEXT,
  "letter_date"    DATE,
  "handled_date"   DATE NOT NULL,
  "subject"        TEXT NOT NULL,
  "summary"        TEXT,
  "category"       "LetterCategory" NOT NULL DEFAULT 'lainnya',
  "status"         "LetterStatus" NOT NULL DEFAULT 'baru',
  "needs_reply"    BOOLEAN NOT NULL DEFAULT false,
  "reply_due_date" DATE,
  "in_reply_to_id" UUID,
  "replied_at"     TIMESTAMPTZ,
  "attachment_id"  UUID,
  "document_id"    UUID,
  "created_by_id"  UUID NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "letters_package_id_fkey";
ALTER TABLE "letters" ADD CONSTRAINT "letters_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "letters_location_id_fkey";
ALTER TABLE "letters" ADD CONSTRAINT "letters_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "letters_in_reply_to_id_fkey";
ALTER TABLE "letters" ADD CONSTRAINT "letters_in_reply_to_id_fkey"
  FOREIGN KEY ("in_reply_to_id") REFERENCES "letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "letters_attachment_id_fkey";
ALTER TABLE "letters" ADD CONSTRAINT "letters_attachment_id_fkey"
  FOREIGN KEY ("attachment_id") REFERENCES "wa_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "letters_document_id_fkey";
ALTER TABLE "letters" ADD CONSTRAINT "letters_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "letters_org_id_agenda_year_agenda_no_key" ON "letters"("org_id", "agenda_year", "agenda_no");
CREATE INDEX IF NOT EXISTS "letters_org_id_handled_date_idx" ON "letters"("org_id", "handled_date");
CREATE INDEX IF NOT EXISTS "letters_package_id_direction_idx" ON "letters"("package_id", "direction");
CREATE INDEX IF NOT EXISTS "letters_status_reply_due_date_idx" ON "letters"("status", "reply_due_date");

-- Tautan surat pada kendala & temuan (tahap 4).
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "letter_id" UUID;
ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_letter_id_fkey";
ALTER TABLE "issues" ADD CONSTRAINT "issues_letter_id_fkey"
  FOREIGN KEY ("letter_id") REFERENCES "letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "letter_id" UUID;
ALTER TABLE "findings" DROP CONSTRAINT IF EXISTS "findings_letter_id_fkey";
ALTER TABLE "findings" ADD CONSTRAINT "findings_letter_id_fkey"
  FOREIGN KEY ("letter_id") REFERENCES "letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
