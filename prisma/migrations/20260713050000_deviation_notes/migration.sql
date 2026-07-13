-- CreateTable
CREATE TABLE "deviation_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "week_no" INTEGER,
    "cause" TEXT NOT NULL,
    "recovery" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deviation_notes_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "deviation_notes_location_id_created_at_idx" ON "deviation_notes"("location_id", "created_at");
