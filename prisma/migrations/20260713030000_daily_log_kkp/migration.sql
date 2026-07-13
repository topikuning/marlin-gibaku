-- CreateEnum
CREATE TYPE "WorkerRole" AS ENUM ('site_manager', 'pelaksana', 'mandor', 'kepala_tukang', 'tukang_bongkar', 'tukang_batu', 'tukang_besi', 'tukang_kayu', 'tukang_pipa', 'tukang_listrik', 'tukang_cat', 'tenaga', 'logistik', 'operator');

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "log_date" DATE NOT NULL,
    "weather" "WeatherCode",
    "work_start" TEXT,
    "work_end" TEXT,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" UUID NOT NULL,
    "role" "WorkerRole" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_log_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "qty_received" DECIMAL(15,3),

    CONSTRAINT "daily_log_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_log_equipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_log_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_logs_location_id_log_date_idx" ON "daily_logs"("location_id", "log_date");
CREATE UNIQUE INDEX "daily_logs_location_id_log_date_key" ON "daily_logs"("location_id", "log_date");
CREATE UNIQUE INDEX "daily_log_workers_log_id_role_key" ON "daily_log_workers"("log_id", "role");
CREATE INDEX "daily_log_workers_log_id_idx" ON "daily_log_workers"("log_id");
CREATE INDEX "daily_log_materials_log_id_idx" ON "daily_log_materials"("log_id");
CREATE INDEX "daily_log_equipment_log_id_idx" ON "daily_log_equipment"("log_id");

-- AddForeignKey
ALTER TABLE "daily_log_workers" ADD CONSTRAINT "daily_log_workers_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_log_materials" ADD CONSTRAINT "daily_log_materials_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_log_equipment" ADD CONSTRAINT "daily_log_equipment_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
