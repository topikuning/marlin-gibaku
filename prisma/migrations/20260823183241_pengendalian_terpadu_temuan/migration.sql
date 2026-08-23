-- PENGENDALIAN TERPADU (DECISIONS 426): temuan pemeriksa, inspeksi lapangan,
-- tautan bukti, dan verifikasi eksternal laporan harian oleh Wakil PPK.
--
-- Idempoten (DECISIONS 167): enum lewat penjaga pg_type, CREATE TABLE/INDEX
-- IF NOT EXISTS, DROP CONSTRAINT/TRIGGER IF EXISTS sebelum ADD/CREATE.
-- Migrasi ini HANYA berisi perubahan fitur ini — drift generator terhadap
-- tabel lama sengaja TIDAK dibawa (bukan urusan migrasi ini).

-- PostgreSQL tidak punya CREATE TYPE IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FindingSource') THEN
    CREATE TYPE "FindingSource" AS ENUM ('inspeksi', 'laporan_harian', 'dokumen', 'manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FindingCategory') THEN
    CREATE TYPE "FindingCategory" AS ENUM ('mutu', 'volume', 'k3', 'administrasi', 'jadwal', 'lingkungan', 'lainnya');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FindingStatus') THEN
    CREATE TYPE "FindingStatus" AS ENUM ('baru', 'menunggu_klarifikasi', 'ditindaklanjuti', 'menunggu_verifikasi', 'selesai', 'dibuka_kembali');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InspectionStatus') THEN
    CREATE TYPE "InspectionStatus" AS ENUM ('draft', 'final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportVerifStatus') THEN
    CREATE TYPE "ReportVerifStatus" AS ENUM ('diverifikasi', 'perlu_klarifikasi', 'ditolak');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EvidenceVerifStatus') THEN
    CREATE TYPE "EvidenceVerifStatus" AS ENUM ('belum', 'diterima', 'ditolak');
  END IF;
END $$;

-- Inspeksi lebih dulu: findings ber-FK ke sini.
CREATE TABLE IF NOT EXISTS "inspections" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "inspector_id" UUID NOT NULL,
    "inspection_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "recommendation" TEXT,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "status" "InspectionStatus" NOT NULL DEFAULT 'draft',
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "findings" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "source" "FindingSource" NOT NULL DEFAULT 'manual',
    "inspection_id" UUID,
    "report_id" UUID,
    "lineage_key" TEXT,
    "work_item_name" TEXT,
    "category" "FindingCategory" NOT NULL DEFAULT 'lainnya',
    "severity" "IssueSeverity" NOT NULL DEFAULT 'sedang',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "finding_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "FindingStatus" NOT NULL DEFAULT 'baru',
    "assigned_to_id" UUID,
    "assigned_name" TEXT,
    "raised_by_id" UUID NOT NULL,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "finding_status_history" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "from_status" "FindingStatus",
    "to_status" "FindingStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "finding_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "finding_clarifications" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "asked_by_id" UUID NOT NULL,
    "asked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "response" TEXT,
    "responded_by_id" UUID,
    "responded_at" TIMESTAMPTZ,

    CONSTRAINT "finding_clarifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "finding_notes" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "evidence_links" (
    "id" UUID NOT NULL,
    "finding_id" UUID,
    "inspection_id" UUID,
    "clarification_id" UUID,
    "photo_id" UUID,
    "document_id" UUID,
    "caption" TEXT,
    "added_by_id" UUID NOT NULL,
    "verif_status" "EvidenceVerifStatus" NOT NULL DEFAULT 'belum',
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "verif_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "report_verifications" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "status" "ReportVerifStatus" NOT NULL,
    "note" TEXT,
    "verified_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "findings_location_id_status_idx" ON "findings"("location_id", "status");
CREATE INDEX IF NOT EXISTS "findings_status_due_date_idx" ON "findings"("status", "due_date");
CREATE INDEX IF NOT EXISTS "findings_severity_status_idx" ON "findings"("severity", "status");
CREATE INDEX IF NOT EXISTS "findings_inspection_id_idx" ON "findings"("inspection_id");
CREATE INDEX IF NOT EXISTS "findings_report_id_idx" ON "findings"("report_id");
CREATE INDEX IF NOT EXISTS "finding_status_history_finding_id_changed_at_idx" ON "finding_status_history"("finding_id", "changed_at");
CREATE INDEX IF NOT EXISTS "finding_clarifications_finding_id_asked_at_idx" ON "finding_clarifications"("finding_id", "asked_at");
CREATE INDEX IF NOT EXISTS "finding_notes_finding_id_created_at_idx" ON "finding_notes"("finding_id", "created_at");
CREATE INDEX IF NOT EXISTS "inspections_location_id_inspection_date_idx" ON "inspections"("location_id", "inspection_date");
CREATE INDEX IF NOT EXISTS "inspections_inspector_id_inspection_date_idx" ON "inspections"("inspector_id", "inspection_date");
CREATE INDEX IF NOT EXISTS "evidence_links_finding_id_idx" ON "evidence_links"("finding_id");
CREATE INDEX IF NOT EXISTS "evidence_links_inspection_id_idx" ON "evidence_links"("inspection_id");
CREATE INDEX IF NOT EXISTS "evidence_links_clarification_id_idx" ON "evidence_links"("clarification_id");
CREATE INDEX IF NOT EXISTS "evidence_links_photo_id_idx" ON "evidence_links"("photo_id");
CREATE INDEX IF NOT EXISTS "evidence_links_document_id_idx" ON "evidence_links"("document_id");
CREATE INDEX IF NOT EXISTS "report_verifications_report_id_created_at_idx" ON "report_verifications"("report_id", "created_at");

ALTER TABLE "findings" DROP CONSTRAINT IF EXISTS "findings_location_id_fkey";
ALTER TABLE "findings" ADD CONSTRAINT "findings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "findings" DROP CONSTRAINT IF EXISTS "findings_inspection_id_fkey";
ALTER TABLE "findings" ADD CONSTRAINT "findings_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "findings" DROP CONSTRAINT IF EXISTS "findings_report_id_fkey";
ALTER TABLE "findings" ADD CONSTRAINT "findings_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "finding_status_history" DROP CONSTRAINT IF EXISTS "finding_status_history_finding_id_fkey";
ALTER TABLE "finding_status_history" ADD CONSTRAINT "finding_status_history_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finding_clarifications" DROP CONSTRAINT IF EXISTS "finding_clarifications_finding_id_fkey";
ALTER TABLE "finding_clarifications" ADD CONSTRAINT "finding_clarifications_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finding_notes" DROP CONSTRAINT IF EXISTS "finding_notes_finding_id_fkey";
ALTER TABLE "finding_notes" ADD CONSTRAINT "finding_notes_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inspections" DROP CONSTRAINT IF EXISTS "inspections_location_id_fkey";
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_finding_id_fkey";
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_inspection_id_fkey";
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_clarification_id_fkey";
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_clarification_id_fkey" FOREIGN KEY ("clarification_id") REFERENCES "finding_clarifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_photo_id_fkey";
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_document_id_fkey";
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_verifications" DROP CONSTRAINT IF EXISTS "report_verifications_report_id_fkey";
ALTER TABLE "report_verifications" ADD CONSTRAINT "report_verifications_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: histori status temuan (pola 20260714005500_append_only_triggers).
DROP TRIGGER IF EXISTS finding_status_history_append_only ON "finding_status_history";
CREATE TRIGGER finding_status_history_append_only
  BEFORE UPDATE OR DELETE ON "finding_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

-- Verifikasi eksternal laporan harian: append-only juga — tiap aksi = baris
-- baru; riwayat pemeriksaan pemberi kerja tidak boleh ditulis ulang.
DROP TRIGGER IF EXISTS report_verifications_append_only ON "report_verifications";
CREATE TRIGGER report_verifications_append_only
  BEFORE UPDATE OR DELETE ON "report_verifications"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

-- EvidenceLink: sumber TEPAT SATU (foto XOR dokumen), induk MINIMAL SATU.
ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_satu_sumber";
ALTER TABLE "evidence_links"
  ADD CONSTRAINT "evidence_links_satu_sumber" CHECK (
    ("photo_id" IS NOT NULL)::int + ("document_id" IS NOT NULL)::int = 1
  );
ALTER TABLE "evidence_links" DROP CONSTRAINT IF EXISTS "evidence_links_punya_induk";
ALTER TABLE "evidence_links"
  ADD CONSTRAINT "evidence_links_punya_induk" CHECK (
    "finding_id" IS NOT NULL OR "inspection_id" IS NOT NULL OR "clarification_id" IS NOT NULL
  );
