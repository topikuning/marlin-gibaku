-- Penanda tangan tambahan menurut Team Leader pengawas BANUSA (2026-10-10).
-- Hanya kolom baru yang boleh kosong; tidak ada data yang diubah.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "team_leader_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "team_leader_ttd_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "co_team_leader_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "co_team_leader_ttd_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "quality_surveyor_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "quality_surveyor_ttd_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "project_manager_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "project_manager_ttd_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "site_manager_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "site_manager_ttd_key" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "co_team_leader_name" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "co_team_leader_ttd_key" TEXT;
