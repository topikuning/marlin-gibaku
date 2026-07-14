-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'program_director', 'regional_manager', 'project_manager', 'site_manager', 'field_supervisor', 'exec_viewer');

-- CreateEnum
CREATE TYPE "PackageStage" AS ENUM ('prospek', 'tender', 'penetapan', 'kontrak', 'pelaksanaan', 'serah_terima', 'selesai', 'batal');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('persiapan', 'berjalan', 'terhenti', 'selesai', 'pho', 'pemeliharaan', 'fho', 'batal');

-- CreateEnum
CREATE TYPE "RabRevisionSource" AS ENUM ('hps_awal', 'adendum');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('draft', 'aktif', 'digantikan');

-- CreateEnum
CREATE TYPE "RabNodeKind" AS ENUM ('kategori', 'sub', 'grup', 'item');

-- CreateEnum
CREATE TYPE "BaselineSource" AS ENUM ('auto', 'adendum', 'manual');

-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('draft', 'dikirim', 'perlu_koreksi', 'disetujui', 'final');

-- CreateEnum
CREATE TYPE "WeatherCode" AS ENUM ('cerah', 'berawan', 'hujan_ringan', 'hujan_deras', 'angin_kencang', 'banjir');

-- CreateEnum
CREATE TYPE "WorkerRole" AS ENUM ('site_manager', 'pelaksana', 'mandor', 'kepala_tukang', 'tukang_bongkar', 'tukang_batu', 'tukang_besi', 'tukang_kayu', 'tukang_pipa', 'tukang_listrik', 'tukang_cat', 'tenaga', 'logistik', 'operator');

-- CreateEnum
CREATE TYPE "PhotoVerification" AS ENUM ('pending', 'passed', 'flagged_gps', 'flagged_time', 'flagged_duplicate', 'rejected');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('rendah', 'sedang', 'tinggi', 'kritis');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('terbuka', 'ditangani', 'selesai');

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('direncanakan', 'berjalan', 'selesai', 'batal');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('material', 'upah', 'alat', 'subkon', 'overhead', 'transport', 'lain');

-- CreateEnum
CREATE TYPE "CommitmentType" AS ENUM ('po', 'kontrak_vendor', 'kasbon');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('draft', 'diajukan', 'disetujui', 'ditolak', 'batal');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('diajukan', 'disetujui', 'ditolak', 'dibayar_sebagian', 'lunas');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('draft', 'diajukan', 'disetujui', 'cair_sebagian', 'cair', 'ditolak');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('belum_dimulai', 'berjalan', 'menunggu_pihak_lain', 'perlu_perbaikan', 'selesai', 'tidak_berlaku');

-- CreateEnum
CREATE TYPE "AdminPhase" AS ENUM ('pemilihan', 'penunjukan', 'kontrak', 'mulai_kerja', 'pelaksanaan', 'adendum', 'serah_terima', 'pembayaran', 'lainnya');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('undangan', 'ba_penjelasan', 'penawaran', 'ba_evaluasi', 'ba_klarifikasi', 'ba_negosiasi', 'penetapan_pemenang', 'sanggah', 'sppbj', 'kontrak', 'jaminan', 'spmk', 'ba_serah_terima_lapangan', 'pcm', 'mc0', 'laporan', 'mc_berkala', 'adendum', 'surat_kendala', 'surat_peringatan', 'bast_pho', 'bast_fho', 'ba_pembayaran', 'invoice', 'faktur_pajak', 'hps', 'lainnya');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,

    CONSTRAINT "location_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "package_number" TEXT,
    "owner_agency" TEXT NOT NULL DEFAULT 'KKP',
    "hps_value" BIGINT NOT NULL DEFAULT 0,
    "stage" "PackageStage" NOT NULL DEFAULT 'prospek',
    "province" TEXT,
    "candidate_vendor_name" TEXT,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_stage_history" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "from_stage" "PackageStage",
    "to_stage" "PackageStage" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "package_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "contact" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "contract_number" TEXT NOT NULL,
    "contract_value" BIGINT NOT NULL,
    "ppn_percent" DECIMAL(5,2) NOT NULL DEFAULT 11,
    "advance_percent" DECIMAL(5,2),
    "retention_percent" DECIMAL(5,2),
    "signed_date" DATE NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "payment_terms" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendments" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "cco_number" TEXT NOT NULL,
    "value_delta" BIGINT NOT NULL,
    "end_date_delta" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "village" TEXT NOT NULL,
    "regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "status" "LocationStatus" NOT NULL DEFAULT 'persiapan',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_status_history" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "from_status" "LocationStatus",
    "to_status" "LocationStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "location_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_revisions" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "source" "RabRevisionSource" NOT NULL,
    "amendment_id" UUID,
    "status" "RevisionStatus" NOT NULL DEFAULT 'draft',
    "total_value" BIGINT NOT NULL,
    "note" TEXT,
    "source_document_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ,

    CONSTRAINT "rab_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_nodes" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "RabNodeKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "volume" DECIMAL(15,3),
    "unit" TEXT,
    "unit_price" DECIMAL(15,2),
    "amount" BIGINT NOT NULL DEFAULT 0,
    "lineage_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "rab_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "baseline_no" INTEGER NOT NULL,
    "source" "BaselineSource" NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'aktif',
    "rab_revision_id" UUID,
    "contract_days" INTEGER NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_points" (
    "id" UUID NOT NULL,
    "baseline_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "planned_pct" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "baseline_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plans" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_items" (
    "id" UUID NOT NULL,
    "weekly_plan_id" UUID NOT NULL,
    "rab_node_id" UUID NOT NULL,
    "target_volume" DECIMAL(15,3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "pic_name" TEXT,
    "note" TEXT,

    CONSTRAINT "weekly_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'draft',
    "weather" "WeatherCode",
    "work_start" TEXT,
    "work_end" TEXT,
    "notes" TEXT,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "created_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMPTZ,
    "final_snapshot" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_status_history" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "from_status" "DailyReportStatus",
    "to_status" "DailyReportStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "daily_report_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_items" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "rab_node_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "volume_done" DECIMAL(15,3) NOT NULL,
    "value_done" BIGINT NOT NULL,
    "notes" TEXT,
    "reported_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "daily_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_workers" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "role" "WorkerRole" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_report_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_materials" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "qty_received" DECIMAL(15,3),

    CONSTRAINT "daily_report_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_equipment" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_report_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "report_id" UUID,
    "report_item_id" UUID,
    "r2_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "exif_gps_lat" DECIMAL(10,7),
    "exif_gps_lng" DECIMAL(10,7),
    "exif_taken_at" TIMESTAMPTZ,
    "verification" "PhotoVerification" NOT NULL DEFAULT 'pending',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "report_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'sedang',
    "status" "IssueStatus" NOT NULL DEFAULT 'terbuka',
    "raised_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_actions" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "pic_user_id" UUID,
    "pic_name" TEXT,
    "due_date" DATE,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'direncanakan',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recovery_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_updates" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'disetujui',
    "note" TEXT,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "vendor_id" UUID,
    "type" "CommitmentType" NOT NULL,
    "number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" BIGINT NOT NULL,
    "due_date" DATE,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'diajukan',
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "commitment_id" UUID,
    "category" "CostCategory" NOT NULL,
    "amount" BIGINT NOT NULL,
    "tx_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'diajukan',
    "evidence_document_id" UUID,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "commitment_id" UUID,
    "number" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'diajukan',
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments_out" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_date" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_out_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_billings" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "termin_no" INTEGER NOT NULL,
    "description" TEXT,
    "amount" BIGINT NOT NULL,
    "retention_held" BIGINT NOT NULL DEFAULT 0,
    "billed_date" DATE,
    "status" "BillingStatus" NOT NULL DEFAULT 'draft',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "owner_billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "id" UUID NOT NULL,
    "owner_billing_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "received_date" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_milestones" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "location_id" UUID,
    "template_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" "AdminPhase" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "pic_user_id" UUID,
    "due_date" DATE,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'belum_dimulai',
    "requires_verification" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ,
    "verified_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "package_id" UUID,
    "contract_id" UUID,
    "location_id" UUID,
    "amendment_id" UUID,
    "milestone_id" UUID,
    "phase" "AdminPhase" NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "doc_number" TEXT,
    "doc_date" DATE,
    "expiry_date" DATE,
    "description" TEXT,
    "r2_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "supersedes_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "ip" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_id" UUID,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "users"("org_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_created_at_idx" ON "login_attempts"("identifier", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- CreateIndex
CREATE INDEX "location_assignments_location_id_idx" ON "location_assignments"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_assignments_user_id_location_id_key" ON "location_assignments"("user_id", "location_id");

-- CreateIndex
CREATE INDEX "packages_org_id_stage_idx" ON "packages"("org_id", "stage");

-- CreateIndex
CREATE INDEX "package_stage_history_package_id_changed_at_idx" ON "package_stage_history"("package_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_org_id_name_key" ON "vendors"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_package_id_key" ON "contracts"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_number_key" ON "contracts"("contract_number");

-- CreateIndex
CREATE INDEX "contracts_vendor_id_idx" ON "contracts"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_amendments_contract_id_cco_number_key" ON "contract_amendments"("contract_id", "cco_number");

-- CreateIndex
CREATE UNIQUE INDEX "locations_slug_key" ON "locations"("slug");

-- CreateIndex
CREATE INDEX "locations_package_id_idx" ON "locations"("package_id");

-- CreateIndex
CREATE INDEX "locations_province_idx" ON "locations"("province");

-- CreateIndex
CREATE INDEX "locations_status_idx" ON "locations"("status");

-- CreateIndex
CREATE INDEX "location_status_history_location_id_changed_at_idx" ON "location_status_history"("location_id", "changed_at");

-- CreateIndex
CREATE INDEX "rab_revisions_location_id_status_idx" ON "rab_revisions"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rab_revisions_location_id_revision_no_key" ON "rab_revisions"("location_id", "revision_no");

-- CreateIndex
CREATE INDEX "rab_nodes_revision_id_parent_id_sort_order_idx" ON "rab_nodes"("revision_id", "parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "rab_nodes_revision_id_kind_idx" ON "rab_nodes"("revision_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "rab_nodes_revision_id_lineage_key_key" ON "rab_nodes"("revision_id", "lineage_key");

-- CreateIndex
CREATE INDEX "baselines_location_id_status_idx" ON "baselines"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_location_id_baseline_no_key" ON "baselines"("location_id", "baseline_no");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_points_baseline_id_week_number_key" ON "baseline_points"("baseline_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plans_location_id_week_number_key" ON "weekly_plans"("location_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_items_weekly_plan_id_rab_node_id_key" ON "weekly_plan_items"("weekly_plan_id", "rab_node_id");

-- CreateIndex
CREATE INDEX "daily_reports_status_idx" ON "daily_reports"("status");

-- CreateIndex
CREATE INDEX "daily_reports_location_id_status_idx" ON "daily_reports"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_location_id_report_date_key" ON "daily_reports"("location_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_report_status_history_report_id_changed_at_idx" ON "daily_report_status_history"("report_id", "changed_at");

-- CreateIndex
CREATE INDEX "daily_report_items_lineage_key_idx" ON "daily_report_items"("lineage_key");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_items_report_id_lineage_key_key" ON "daily_report_items"("report_id", "lineage_key");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_workers_report_id_role_key" ON "daily_report_workers"("report_id", "role");

-- CreateIndex
CREATE INDEX "daily_report_materials_report_id_idx" ON "daily_report_materials"("report_id");

-- CreateIndex
CREATE INDEX "daily_report_equipment_report_id_idx" ON "daily_report_equipment"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "photos_r2_key_key" ON "photos"("r2_key");

-- CreateIndex
CREATE UNIQUE INDEX "photos_sha256_key" ON "photos"("sha256");

-- CreateIndex
CREATE INDEX "photos_report_id_idx" ON "photos"("report_id");

-- CreateIndex
CREATE INDEX "photos_report_item_id_idx" ON "photos"("report_item_id");

-- CreateIndex
CREATE INDEX "issues_location_id_status_idx" ON "issues"("location_id", "status");

-- CreateIndex
CREATE INDEX "recovery_actions_issue_id_idx" ON "recovery_actions"("issue_id");

-- CreateIndex
CREATE INDEX "recovery_updates_action_id_created_at_idx" ON "recovery_updates"("action_id", "created_at");

-- CreateIndex
CREATE INDEX "budget_lines_location_id_category_idx" ON "budget_lines"("location_id", "category");

-- CreateIndex
CREATE INDEX "commitments_location_id_status_idx" ON "commitments"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_location_id_number_key" ON "commitments"("location_id", "number");

-- CreateIndex
CREATE INDEX "expenses_location_id_tx_date_idx" ON "expenses"("location_id", "tx_date");

-- CreateIndex
CREATE INDEX "expenses_commitment_id_idx" ON "expenses"("commitment_id");

-- CreateIndex
CREATE INDEX "invoices_location_id_status_idx" ON "invoices"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_location_id_number_key" ON "invoices"("location_id", "number");

-- CreateIndex
CREATE INDEX "payments_out_invoice_id_idx" ON "payments_out"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_billings_contract_id_termin_no_key" ON "owner_billings"("contract_id", "termin_no");

-- CreateIndex
CREATE INDEX "disbursements_owner_billing_id_idx" ON "disbursements"("owner_billing_id");

-- CreateIndex
CREATE INDEX "admin_milestones_package_id_phase_sort_order_idx" ON "admin_milestones"("package_id", "phase", "sort_order");

-- CreateIndex
CREATE INDEX "admin_milestones_location_id_idx" ON "admin_milestones"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_r2_key_key" ON "documents"("r2_key");

-- CreateIndex
CREATE INDEX "documents_package_id_phase_idx" ON "documents"("package_id", "phase");

-- CreateIndex
CREATE INDEX "documents_location_id_phase_idx" ON "documents"("location_id", "phase");

-- CreateIndex
CREATE INDEX "documents_org_id_sha256_idx" ON "documents"("org_id", "sha256");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "alerts_location_id_resolved_at_idx" ON "alerts"("location_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_key_effective_from_key" ON "app_settings"("key", "effective_from");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assignments" ADD CONSTRAINT "location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assignments" ADD CONSTRAINT "location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_stage_history" ADD CONSTRAINT "package_stage_history_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_status_history" ADD CONSTRAINT "location_status_history_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_nodes" ADD CONSTRAINT "rab_nodes_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_nodes" ADD CONSTRAINT "rab_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rab_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_rab_revision_id_fkey" FOREIGN KEY ("rab_revision_id") REFERENCES "rab_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_points" ADD CONSTRAINT "baseline_points_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_items" ADD CONSTRAINT "weekly_plan_items_weekly_plan_id_fkey" FOREIGN KEY ("weekly_plan_id") REFERENCES "weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_items" ADD CONSTRAINT "weekly_plan_items_rab_node_id_fkey" FOREIGN KEY ("rab_node_id") REFERENCES "rab_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_status_history" ADD CONSTRAINT "daily_report_status_history_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_rab_node_id_fkey" FOREIGN KEY ("rab_node_id") REFERENCES "rab_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_workers" ADD CONSTRAINT "daily_report_workers_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_materials" ADD CONSTRAINT "daily_report_materials_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_equipment" ADD CONSTRAINT "daily_report_equipment_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_item_id_fkey" FOREIGN KEY ("report_item_id") REFERENCES "daily_report_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_updates" ADD CONSTRAINT "recovery_updates_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "recovery_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_out" ADD CONSTRAINT "payments_out_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_billings" ADD CONSTRAINT "owner_billings_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_owner_billing_id_fkey" FOREIGN KEY ("owner_billing_id") REFERENCES "owner_billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_milestones" ADD CONSTRAINT "admin_milestones_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_milestones" ADD CONSTRAINT "admin_milestones_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "admin_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
