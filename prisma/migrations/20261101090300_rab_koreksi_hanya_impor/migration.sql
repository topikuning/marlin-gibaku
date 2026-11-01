-- KOREKSI HANYA DARI JALUR IMPOR (DECISIONS 728, pilihan user 2026-11-01:
-- "pakai aturan jalur, super admin utama tetap boleh aktifkan CCO").
--
-- Jejak audit `rab.aktivasi_tanpa_persetujuan` tidak membedakan koreksi dari
-- CCO sungguhan. Yang membedakan hanya JALURNYA:
-- - `impor` = pilihan "Jadikan RAB AKTIF" pada impor = KOREKSI (tetap);
-- - jalur lain (`tombol_aktifkan`) = DRAFT adendum yang diaktifkan tanpa
--   menunggu dua persetujuan = ADENDUM (MC-0/CCO), dikembalikan di sini.
--   682 sendiri lahir dari CCO Krakahan yang ingin diaktifkan dengan cara ini.
--
-- 090100/090200 sudah mengubah semua revisi jalan pintas dan sudah terpasang
-- di server DEV, jadi tidak diubah; berkas ini meluruskan hasilnya.
--
-- Idempoten: langkah 1 hanya menyentuh koreksi yang tidak berjalur impor
-- (sesudah sekali jalan tidak ada lagi); langkah 2 dihitung ulang dari revisi
-- bukan-koreksi yang tidak diubahnya.

-- 1. Draft adendum yang diaktifkan lewat tombol: kembali menjadi adendum.
--    Status CCO-nya dipulihkan seperti saat diaktifkan (adendum yang
--    menggantikan RAB aktif selalu ditandai menunggu CCO), kecuali yang
--    sudah tercatat dalam CCO paket.
UPDATE "rab_revisions" r
SET "source" = 'adendum',
    "awaiting_cco" = (
      r."amendment_id" IS NULL
      AND EXISTS (
        SELECT 1 FROM "rab_revisions" p
        WHERE p."location_id" = r."location_id"
          AND p."revision_no" < r."revision_no"
          AND p."status" IN ('aktif', 'digantikan')
      )
    )
WHERE r."source" = 'koreksi'
  AND r."status" <> 'draft'
  AND EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."action" = 'rab.aktivasi_tanpa_persetujuan'
      AND a."resource_type" = 'rab_revision'
      AND a."resource_id" = r."id"::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."action" = 'rab.aktivasi_tanpa_persetujuan'
      AND a."resource_type" = 'rab_revision'
      AND a."resource_id" = r."id"::text
      AND a."payload"->>'jalur' = 'impor'
  );

-- 2. Koreksi (jalur impor) mewarisi status CCO revisi yang dikoreksinya –
--    dihitung ULANG karena revisi sebelumnya bisa saja baru kembali menjadi
--    adendum di langkah 1. Sama dengan 090200.
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
