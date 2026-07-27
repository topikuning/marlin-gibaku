-- SATU revisi RAB aktif dan SATU baseline aktif per lokasi (audit 2026-07-27, C1).
--
-- Query realisasi (src/lib/progress.ts) JOIN ke rab_revisions ... status='aktif'.
-- Dua revisi aktif pada satu lokasi = fan-out = realisasi terhitung DOBEL, tanpa
-- error dan tanpa test yang gagal. Aktivasi di aplikasi sudah atomik
-- (rab/import.ts activateRevision di dalam $transaction), tetapi dua transaksi
-- yang berjalan bersamaan pada isolation level default masih bisa lolos —
-- constraint ini yang menutupnya, bukan disiplin kode.
--
-- Prisma tidak memodelkan partial unique index, jadi ditulis sebagai SQL mentah;
-- `migrate diff` sudah diverifikasi TIDAK menganggapnya drift.

-- 1. Rapikan duplikat yang mungkin sudah ada: pertahankan nomor revisi/baseline
--    TERTINGGI sebagai yang aktif, sisanya jadi "digantikan".
UPDATE "rab_revisions" r SET "status" = 'digantikan', "superseded_at" = COALESCE("superseded_at", now())
WHERE r."status" = 'aktif'
  AND r."id" <> (
    SELECT r2."id" FROM "rab_revisions" r2
    WHERE r2."location_id" = r."location_id" AND r2."status" = 'aktif'
    ORDER BY r2."revision_no" DESC, r2."created_at" DESC, r2."id" DESC
    LIMIT 1
  );

UPDATE "baselines" b SET "status" = 'digantikan', "superseded_at" = COALESCE("superseded_at", now())
WHERE b."status" = 'aktif'
  AND b."id" <> (
    SELECT b2."id" FROM "baselines" b2
    WHERE b2."location_id" = b."location_id" AND b2."status" = 'aktif'
    ORDER BY b2."baseline_no" DESC, b2."created_at" DESC, b2."id" DESC
    LIMIT 1
  );

-- 2. Constraint.
CREATE UNIQUE INDEX "rab_revisions_one_active_per_location"
  ON "rab_revisions" ("location_id") WHERE "status" = 'aktif';

CREATE UNIQUE INDEX "baselines_one_active_per_location"
  ON "baselines" ("location_id") WHERE "status" = 'aktif';
