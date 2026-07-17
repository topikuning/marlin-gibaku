-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by_id" UUID;

-- CreateIndex
CREATE INDEX "users_created_by_id_idx" ON "users"("created_by_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
