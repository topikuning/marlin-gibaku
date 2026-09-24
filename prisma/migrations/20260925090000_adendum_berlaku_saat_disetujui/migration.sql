-- DECISIONS 614: dua persetujuan = BERLAKU; nomor CCO administrasi yang menyusul.

-- Revisi RAB adendum yang diaktifkan per lokasi sebelum ber-CCO.
ALTER TABLE "rab_revisions" ADD COLUMN IF NOT EXISTS "awaiting_cco" BOOLEAN NOT NULL DEFAULT false;

-- Paket tempat perubahan lingkup diajukan. Dulu tersirat dari CCO-nya; kini
-- baris bisa berlaku tanpa CCO, jadi paketnya dicatat sendiri.
ALTER TABLE "location_scope_changes" ADD COLUMN IF NOT EXISTS "package_id" UUID;
UPDATE "location_scope_changes" s
   SET "package_id" = c."package_id"
  FROM "contract_amendments" a
  JOIN "contracts" c ON c."id" = a."contract_id"
 WHERE s."amendment_id" = a."id" AND s."package_id" IS NULL;
UPDATE "location_scope_changes" s
   SET "package_id" = l."package_id"
  FROM "locations" l
 WHERE l."id" = s."location_id" AND s."package_id" IS NULL;

-- Usulan yang SUDAH lengkap empat matanya di bawah aturan 613 (menunggu CCO
-- untuk berlaku) diberlakukan sejak persetujuan terakhirnya. Suara yang lebih
-- tua dari perubahan terakhir usulan gugur, sama seperti aturan di kode.
UPDATE "location_scope_changes" s
   SET "status" = 'aktif',
       "applied_at" = v.t,
       "effective_date" = (v.t AT TIME ZONE 'Asia/Jakarta')::date
  FROM (
    SELECT a."change_id", max(a."approved_at") AS t
      FROM "location_scope_approvals" a
      JOIN "location_scope_changes" c ON c."id" = a."change_id"
     WHERE a."approved_at" >= c."updated_at"
     GROUP BY a."change_id"
    HAVING count(*) FILTER (WHERE a."role" = 'program_director') > 0
       AND count(*) FILTER (WHERE a."role" IN ('regional_manager', 'project_manager', 'site_manager')) > 0
  ) v
 WHERE s."id" = v."change_id" AND s."status" = 'draft';
