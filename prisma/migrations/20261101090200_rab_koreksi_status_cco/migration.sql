-- KOREKSI TIDAK MENGUBAH STATUS CCO (DECISIONS 728, lanjutan).
--
-- Migrasi 20261101090100 menyetel `awaiting_cco = false` pada SEMUA revisi
-- jalan pintas yang kini menjadi koreksi. Itu salah bila revisi yang
-- dikoreksinya adalah adendum sah yang BELUM masuk CCO: revisi koreksi lalu
-- menjadi "dasar yang sudah tercakup CCO", dan selisih adendum sah itu hilang
-- dari CCO paket berikutnya. Dulu jejaknya pun tidak seragam: impor "Jadikan
-- RAB AKTIF" tidak pernah menandai menunggu CCO, tombol draft selalu
-- menandainya.
--
-- Aturannya kini sama dengan koreksi baru yang menimpa di tempat: koreksi
-- MEWARISI status CCO revisi yang dikoreksinya, yaitu revisi terdekat
-- sebelumnya (aktif/digantikan) yang bukan koreksi.
-- - Revisi yang SUDAH tercatat dalam CCO (`amendment_id` terisi) tidak
--   disentuh: CCO-nya sudah terbit, uangnya sudah dihitung.
-- - Berkas 090100 tidak diubah karena sudah terpasang di server DEV.
--
-- Idempoten: nilainya dihitung ulang dari revisi bukan-koreksi, yang tidak
-- diubah di sini; menjalankan ulang memberi hasil yang sama.
UPDATE "rab_revisions" r
SET "awaiting_cco" = COALESCE(
  (
    SELECT p."awaiting_cco"
    FROM "rab_revisions" p
    WHERE p."location_id" = r."location_id"
      AND p."revision_no" < r."revision_no"
      AND p."status" IN ('aktif', 'digantikan')
      AND p."source" <> 'koreksi'
    ORDER BY p."revision_no" DESC
    LIMIT 1
  ),
  false
)
WHERE r."source" = 'koreksi'
  AND r."status" <> 'draft'
  AND r."amendment_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."action" = 'rab.aktivasi_tanpa_persetujuan'
      AND a."resource_type" = 'rab_revision'
      AND a."resource_id" = r."id"::text
  );
