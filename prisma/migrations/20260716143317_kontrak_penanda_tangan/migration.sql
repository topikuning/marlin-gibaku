-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contractor_signer_name" TEXT,
ADD COLUMN     "contractor_signer_title" TEXT,
ADD COLUMN     "ppk_name" TEXT,
ADD COLUMN     "ppk_nip" TEXT,
ADD COLUMN     "supervisor_firm" TEXT,
ADD COLUMN     "supervisor_name" TEXT;
