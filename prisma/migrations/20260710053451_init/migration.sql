-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'program_director', 'regional_manager', 'project_manager', 'site_manager', 'field_supervisor', 'exec_viewer');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('planning', 'in_progress', 'paused', 'completed', 'handed_over', 'cancelled');

-- CreateEnum
CREATE TYPE "WeatherCode" AS ENUM ('cerah', 'berawan', 'hujan_ringan', 'hujan_deras', 'angin_kencang', 'banjir');

-- CreateEnum
CREATE TYPE "PhotoVerification" AS ENUM ('pending', 'passed', 'flagged_gps', 'flagged_time', 'flagged_duplicate', 'rejected');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('material', 'upah', 'alat', 'overhead', 'transport', 'lain');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('no_report_3d', 'no_report_7d', 'gap_gt_5pct', 'gap_gt_10pct', 'cost_over_budget', 'photo_flagged', 'weekly_plan_missing', 'unplanned_item_added');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('device_binding', 'pin_reset', 'admin_action');

-- CreateEnum
CREATE TYPE "SuggestionSource" AS ENUM ('manual', 'wa_text', 'paper_transcribe');

-- CreateEnum
CREATE TYPE "ReportItemState" AS ENUM ('draft_mandor', 'draft_sm', 'approved', 'sent', 'rejected');

-- CreateEnum
CREATE TYPE "SyncQueueStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "username" TEXT,
    "email" TEXT,
    "phone_e164" TEXT,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ip" INET,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_location_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,

    CONSTRAINT "user_location_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "contractor_id" UUID NOT NULL,
    "contract_number" TEXT NOT NULL,
    "contract_value" BIGINT NOT NULL,
    "signed_date" DATE NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "cco_number" TEXT NOT NULL,
    "value_delta" BIGINT NOT NULL,
    "end_date_delta" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "attachment_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "contract_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "village" TEXT NOT NULL,
    "regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "gps_lat" DECIMAL(10,7) NOT NULL,
    "gps_lng" DECIMAL(10,7) NOT NULL,
    "geofence_radius_m" INTEGER NOT NULL DEFAULT 500,
    "status" "LocationStatus" NOT NULL DEFAULT 'planning',
    "hps_file_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "roman_numeral" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total_value" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rab_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_subcategories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total_value" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "rab_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID,
    "subcategory_id" UUID,
    "parent_item_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "volume" DECIMAL(15,3),
    "unit" TEXT,
    "unit_price" DECIMAL(15,2),
    "total_price" DECIMAL(15,2),
    "tkdn_ratio" DECIMAL(5,4),
    "is_unplanned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rab_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "rab_item_id" UUID,
    "week_number" INTEGER NOT NULL,
    "target_volume" DECIMAL(15,3),
    "target_progress_pct" DECIMAL(6,3) NOT NULL,
    "target_value" BIGINT,

    CONSTRAINT "scheduled_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "allocated" BIGINT NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "from_status" "LocationStatus",
    "to_status" "LocationStatus" NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "location_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "device_id" UUID,
    "report_date" DATE NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gps_lat" DECIMAL(10,7),
    "gps_lng" DECIMAL(10,7),
    "weather" "WeatherCode",
    "team_present" INTEGER,
    "notes" TEXT,
    "supersedes_id" UUID,
    "signature_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_report_id" UUID,
    "rab_item_id" UUID NOT NULL,
    "volume_done" DECIMAL(15,3) NOT NULL,
    "volume_cumulative" DECIMAL(15,3) NOT NULL,
    "value_done" BIGINT NOT NULL,
    "state" "ReportItemState" NOT NULL DEFAULT 'draft_sm',
    "suggestion_source" "SuggestionSource" NOT NULL DEFAULT 'manual',
    "suggested_by_user_id" UUID,
    "suggested_at" TIMESTAMPTZ,
    "suggestion_raw" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejected_reason" TEXT,
    "was_outside_plan" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_report_id" UUID,
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
    "verification_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_report_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "receipt_photo_id" UUID,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "weekly_plan_id" UUID NOT NULL,
    "rab_item_id" UUID NOT NULL,
    "target_volume" DECIMAL(15,3) NOT NULL,
    "target_value" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "weekly_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "progress_delta_pct" DECIMAL(6,3) NOT NULL,
    "progress_cumulative_pct" DECIMAL(6,3) NOT NULL,
    "cost_realized" BIGINT NOT NULL,
    "narrative" TEXT,
    "pdf_url" TEXT,
    "xlsx_url" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "year_month" TEXT NOT NULL,
    "progress_cumulative_pct" DECIMAL(6,3) NOT NULL,
    "cost_realized" BIGINT NOT NULL,
    "photo_count" INTEGER NOT NULL,
    "pdf_url" TEXT,
    "xlsx_url" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "metadata" JSONB,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "device_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "ip" INET,
    "user_agent" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "client_ref" TEXT NOT NULL,
    "operation" JSONB NOT NULL,
    "status" "SyncQueueStatus" NOT NULL DEFAULT 'pending',
    "error_msg" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "users"("org_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "devices_fingerprint_key" ON "devices"("fingerprint");

-- CreateIndex
CREATE INDEX "devices_user_id_revoked_at_idx" ON "devices"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_location_assignments_location_id_unassigned_at_idx" ON "user_location_assignments"("location_id", "unassigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_location_assignments_user_id_location_id_assigned_at_key" ON "user_location_assignments"("user_id", "location_id", "assigned_at");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_used_at_expires_at_idx" ON "otp_codes"("user_id", "used_at", "expires_at");

-- CreateIndex
CREATE INDEX "contractors_org_id_idx" ON "contractors"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_org_id_name_key" ON "contractors"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_number_key" ON "contracts"("contract_number");

-- CreateIndex
CREATE INDEX "contracts_org_id_idx" ON "contracts"("org_id");

-- CreateIndex
CREATE INDEX "contracts_contractor_id_idx" ON "contracts"("contractor_id");

-- CreateIndex
CREATE INDEX "contract_amendments_contract_id_idx" ON "contract_amendments"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_slug_key" ON "locations"("slug");

-- CreateIndex
CREATE INDEX "locations_province_idx" ON "locations"("province");

-- CreateIndex
CREATE INDEX "locations_status_idx" ON "locations"("status");

-- CreateIndex
CREATE INDEX "locations_org_id_idx" ON "locations"("org_id");

-- CreateIndex
CREATE INDEX "locations_contract_id_idx" ON "locations"("contract_id");

-- CreateIndex
CREATE INDEX "rab_categories_location_id_sort_order_idx" ON "rab_categories"("location_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "rab_categories_location_id_name_key" ON "rab_categories"("location_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rab_subcategories_category_id_code_key" ON "rab_subcategories"("category_id", "code");

-- CreateIndex
CREATE INDEX "rab_items_category_id_idx" ON "rab_items"("category_id");

-- CreateIndex
CREATE INDEX "rab_items_subcategory_id_idx" ON "rab_items"("subcategory_id");

-- CreateIndex
CREATE INDEX "rab_items_parent_item_id_idx" ON "rab_items"("parent_item_id");

-- CreateIndex
CREATE INDEX "scheduled_milestones_location_id_week_number_idx" ON "scheduled_milestones"("location_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_milestones_location_id_rab_item_id_week_number_key" ON "scheduled_milestones"("location_id", "rab_item_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_location_id_category_key" ON "budget_lines"("location_id", "category");

-- CreateIndex
CREATE INDEX "location_status_history_location_id_changed_at_idx" ON "location_status_history"("location_id", "changed_at");

-- CreateIndex
CREATE INDEX "daily_reports_location_id_report_date_idx" ON "daily_reports"("location_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_reports_submitted_at_idx" ON "daily_reports"("submitted_at");

-- CreateIndex
CREATE INDEX "daily_report_items_daily_report_id_idx" ON "daily_report_items"("daily_report_id");

-- CreateIndex
CREATE INDEX "daily_report_items_rab_item_id_idx" ON "daily_report_items"("rab_item_id");

-- CreateIndex
CREATE INDEX "daily_report_items_state_approved_at_idx" ON "daily_report_items"("state", "approved_at");

-- CreateIndex
CREATE UNIQUE INDEX "photos_r2_key_key" ON "photos"("r2_key");

-- CreateIndex
CREATE UNIQUE INDEX "photos_sha256_key" ON "photos"("sha256");

-- CreateIndex
CREATE INDEX "photos_daily_report_id_idx" ON "photos"("daily_report_id");

-- CreateIndex
CREATE INDEX "photos_report_item_id_idx" ON "photos"("report_item_id");

-- CreateIndex
CREATE INDEX "photos_verification_idx" ON "photos"("verification");

-- CreateIndex
CREATE INDEX "cost_entries_daily_report_id_idx" ON "cost_entries"("daily_report_id");

-- CreateIndex
CREATE INDEX "weekly_plans_location_id_week_start_idx" ON "weekly_plans"("location_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plans_location_id_week_number_key" ON "weekly_plans"("location_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plan_items_weekly_plan_id_rab_item_id_key" ON "weekly_plan_items"("weekly_plan_id", "rab_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reports_location_id_week_number_key" ON "weekly_reports"("location_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reports_location_id_year_month_key" ON "monthly_reports"("location_id", "year_month");

-- CreateIndex
CREATE INDEX "alerts_location_id_resolved_at_idx" ON "alerts"("location_id", "resolved_at");

-- CreateIndex
CREATE INDEX "alerts_severity_resolved_at_idx" ON "alerts"("severity", "resolved_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "sync_queue_status_received_at_idx" ON "sync_queue"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_queue_user_id_client_ref_key" ON "sync_queue"("user_id", "client_ref");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_categories" ADD CONSTRAINT "rab_categories_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_subcategories" ADD CONSTRAINT "rab_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "rab_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_items" ADD CONSTRAINT "rab_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "rab_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_items" ADD CONSTRAINT "rab_items_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "rab_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_items" ADD CONSTRAINT "rab_items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "rab_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_milestones" ADD CONSTRAINT "scheduled_milestones_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_milestones" ADD CONSTRAINT "scheduled_milestones_rab_item_id_fkey" FOREIGN KEY ("rab_item_id") REFERENCES "rab_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_status_history" ADD CONSTRAINT "location_status_history_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_rab_item_id_fkey" FOREIGN KEY ("rab_item_id") REFERENCES "rab_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_suggested_by_user_id_fkey" FOREIGN KEY ("suggested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_item_id_fkey" FOREIGN KEY ("report_item_id") REFERENCES "daily_report_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_items" ADD CONSTRAINT "weekly_plan_items_weekly_plan_id_fkey" FOREIGN KEY ("weekly_plan_id") REFERENCES "weekly_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plan_items" ADD CONSTRAINT "weekly_plan_items_rab_item_id_fkey" FOREIGN KEY ("rab_item_id") REFERENCES "rab_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- CHECK CONSTRAINTS (lihat OPEN_ISSUES: dual-parent + login identifier)
-- ─────────────────────────────────────────────────────────────

-- User wajib punya minimal 1 login identifier (username ATAU email). DECISIONS 019.
ALTER TABLE "users"
  ADD CONSTRAINT "users_login_identifier_present"
  CHECK ("username" IS NOT NULL OR "email" IS NOT NULL);

-- RAB item wajib punya minimal 1 parent (kategori / subkategori / parent item).
ALTER TABLE "rab_items"
  ADD CONSTRAINT "rab_items_parent_present"
  CHECK ("category_id" IS NOT NULL OR "subcategory_id" IS NOT NULL OR "parent_item_id" IS NOT NULL);

-- Photo wajib nempel ke report atau report item (tidak boleh orphan).
ALTER TABLE "photos"
  ADD CONSTRAINT "photos_parent_present"
  CHECK ("daily_report_id" IS NOT NULL OR "report_item_id" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- APPEND-ONLY ENFORCEMENT (DECISIONS 006)
-- Koreksi = insert row baru dengan supersedes_id, bukan UPDATE/DELETE.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION raise_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only: operasi % tidak diizinkan (lihat DECISIONS 006)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_reports_append_only
  BEFORE UPDATE OR DELETE ON "daily_reports"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();

CREATE TRIGGER contract_amendments_append_only
  BEFORE UPDATE OR DELETE ON "contract_amendments"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();

CREATE TRIGGER location_status_history_append_only
  BEFORE UPDATE OR DELETE ON "location_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();
