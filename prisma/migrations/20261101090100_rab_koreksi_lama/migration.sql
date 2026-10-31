-- Revisi yang dulu diaktifkan lewat JALAN PINTAS super admin utama (tanpa dua
-- persetujuan, DECISIONS 682) adalah KOREKSI, bukan adendum (ketetapan user
-- 2026-11-01, DECISIONS 728). Berlaku untuk SEMUA lokasi sekaligus: yang
-- dikenali adalah jejak audit `rab.aktivasi_tanpa_persetujuan` (append-only),
-- bukan pilihan per lokasi. Koreksi tidak menunggu nomor CCO.
-- Idempoten: hanya baris yang masih `adendum` yang diubah.
UPDATE "rab_revisions" r
SET "source" = 'koreksi', "awaiting_cco" = false
WHERE r."source" = 'adendum'
  AND r."status" <> 'draft'
  AND EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."action" = 'rab.aktivasi_tanpa_persetujuan'
      AND a."resource_type" = 'rab_revision'
      AND a."resource_id" = r."id"::text
  );
