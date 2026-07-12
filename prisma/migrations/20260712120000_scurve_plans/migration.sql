-- CreateEnum
CREATE TYPE "ScurvePlanSource" AS ENUM ('auto', 'adendum', 'manual');

-- CreateTable
CREATE TABLE "scurve_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "plan_no" INTEGER NOT NULL,
    "source" "ScurvePlanSource" NOT NULL,
    "status" "RabRevisionStatus" NOT NULL DEFAULT 'active',
    "based_on_revision_id" UUID,
    "contract_days" INTEGER NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ,

    CONSTRAINT "scurve_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scurve_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "target_progress_pct" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "scurve_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scurve_plans_location_id_status_idx" ON "scurve_plans"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scurve_plans_location_id_plan_no_key" ON "scurve_plans"("location_id", "plan_no");

-- CreateIndex
CREATE UNIQUE INDEX "scurve_milestones_plan_id_week_number_key" ON "scurve_milestones"("plan_id", "week_number");

-- AddForeignKey
ALTER TABLE "scurve_plans" ADD CONSTRAINT "scurve_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scurve_plans" ADD CONSTRAINT "scurve_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scurve_milestones" ADD CONSTRAINT "scurve_milestones_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "scurve_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
