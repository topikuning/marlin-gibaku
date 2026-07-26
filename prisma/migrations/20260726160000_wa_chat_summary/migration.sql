-- CreateTable
CREATE TABLE "wa_chat_summaries" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "summary_date" DATE NOT NULL,
    "message_count" INTEGER NOT NULL,
    "summary_text" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wa_chat_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wa_chat_summaries_summary_date_idx" ON "wa_chat_summaries"("summary_date");

-- CreateIndex
CREATE UNIQUE INDEX "wa_chat_summaries_package_id_summary_date_key" ON "wa_chat_summaries"("package_id", "summary_date");

-- AddForeignKey
ALTER TABLE "wa_chat_summaries" ADD CONSTRAINT "wa_chat_summaries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

