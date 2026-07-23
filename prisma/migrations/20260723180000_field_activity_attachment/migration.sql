-- CreateTable
CREATE TABLE "field_activity_attachments" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "r2_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_activity_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "field_activity_attachments_r2_key_key" ON "field_activity_attachments"("r2_key");

-- CreateIndex
CREATE INDEX "field_activity_attachments_activity_id_idx" ON "field_activity_attachments"("activity_id");

-- AddForeignKey
ALTER TABLE "field_activity_attachments" ADD CONSTRAINT "field_activity_attachments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "field_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
