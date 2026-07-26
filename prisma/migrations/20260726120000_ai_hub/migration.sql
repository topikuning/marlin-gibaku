-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('pulse', 'deviasi', 'risiko', 'kualitas_data', 'laporan', 'tanya');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('berjalan', 'siap', 'gagal');

-- CreateEnum
CREATE TYPE "AiArtifactKind" AS ENUM ('laporan', 'saran');

-- CreateEnum
CREATE TYPE "AiArtifactStatus" AS ENUM ('draft', 'direview', 'disetujui', 'beku', 'terkirim');

-- AlterTable
ALTER TABLE "field_activity_kinds" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "report_dispatches" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wa_contacts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wa_messages" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "run_kind" "AiRunKind" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'berjalan',
    "scope_type" TEXT NOT NULL,
    "scope_ids" JSONB NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_hash" TEXT,
    "source_snapshot_at" TIMESTAMPTZ,
    "readiness_score" INTEGER,
    "confidence" INTEGER,
    "sources_json" JSONB,
    "output_json" JSONB,
    "limitations" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "estimated_cost_usd" DECIMAL(12,6),
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_artifacts" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "kind" "AiArtifactKind" NOT NULL,
    "template_key" TEXT,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AiArtifactStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "structured_content" JSONB NOT NULL,
    "rendered_text" TEXT,
    "human_edit_note" TEXT,
    "created_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "frozen_at" TIMESTAMPTZ,
    "content_hash" TEXT,
    "distributions" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "scope_ids" JSONB NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "confidence" INTEGER,
    "run_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_user_id_created_at_idx" ON "ai_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_run_kind_created_at_idx" ON "ai_runs"("run_kind", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_status_created_at_idx" ON "ai_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_artifacts_run_id_idx" ON "ai_artifacts"("run_id");

-- CreateIndex
CREATE INDEX "ai_artifacts_kind_status_idx" ON "ai_artifacts"("kind", "status");

-- CreateIndex
CREATE INDEX "ai_artifacts_status_updated_at_idx" ON "ai_artifacts"("status", "updated_at");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

