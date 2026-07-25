-- CreateEnum
CREATE TYPE "PhotoMetadataSource" AS ENUM ('exif', 'device', 'server', 'manual');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN "metadata_source" "PhotoMetadataSource" NOT NULL DEFAULT 'server';
