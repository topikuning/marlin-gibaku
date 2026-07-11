-- CreateEnum
CREATE TYPE "RabRevisionSource" AS ENUM ('initial_hps', 'adendum');

-- CreateEnum
CREATE TYPE "RabRevisionStatus" AS ENUM ('active', 'superseded');

-- DropIndex
DROP INDEX "rab_categories_location_id_name_key";

-- AlterTable
ALTER TABLE "contractors" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "contracts" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "rab_categories" ADD COLUMN     "revision_id" UUID;

-- AlterTable
ALTER TABLE "rab_items" ADD COLUMN     "lineage_id" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "org_id" SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateTable
CREATE TABLE "rab_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "source" "RabRevisionSource" NOT NULL,
    "amendment_id" UUID,
    "effective_date" DATE,
    "note" TEXT,
    "status" "RabRevisionStatus" NOT NULL DEFAULT 'active',
    "total_value" BIGINT NOT NULL,
    "hps_file_doc_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ,

    CONSTRAINT "rab_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rab_revisions_location_id_status_idx" ON "rab_revisions"("location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rab_revisions_location_id_revision_no_key" ON "rab_revisions"("location_id", "revision_no");

-- CreateIndex
CREATE INDEX "rab_categories_revision_id_sort_order_idx" ON "rab_categories"("revision_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "rab_categories_revision_id_name_key" ON "rab_categories"("revision_id", "name");

-- CreateIndex
CREATE INDEX "rab_items_lineage_id_idx" ON "rab_items"("lineage_id");

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_revisions" ADD CONSTRAINT "rab_revisions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_categories" ADD CONSTRAINT "rab_categories_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

