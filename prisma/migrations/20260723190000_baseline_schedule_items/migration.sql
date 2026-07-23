-- CreateTable
CREATE TABLE "baseline_schedule_items" (
    "id" UUID NOT NULL,
    "baseline_id" UUID NOT NULL,
    "lineage_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight_pct" DECIMAL(6,3) NOT NULL,
    "start_week" INTEGER NOT NULL,
    "end_week" INTEGER NOT NULL,

    CONSTRAINT "baseline_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "baseline_schedule_items_baseline_id_lineage_key_key" ON "baseline_schedule_items"("baseline_id", "lineage_key");

-- AddForeignKey
ALTER TABLE "baseline_schedule_items" ADD CONSTRAINT "baseline_schedule_items_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
