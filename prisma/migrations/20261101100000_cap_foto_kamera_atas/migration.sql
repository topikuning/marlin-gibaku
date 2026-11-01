-- DECISIONS 734: cap MARLIN menimpa cap aplikasi kamera di ATAS foto, dan
-- perbaikan cap menganggap jam "diketik manual" hanya karena detiknya hilang.
--
-- 1. Jam yang dicatat manual PALSU dikembalikan.
--    Kolom waktu di form perbaikan cap hanya sampai menit; jam EXIF berdetik.
--    Selisih detik itu dihitung "diketik": jam terpotong ke menit dan sumber
--    waktunya jadi `manual`. Yang dikembalikan hanya revisi yang PERSIS
--    begitu – jam sebelum & sesudah sama-sama diketahui, menitnya sama, cuma
--    detiknya hilang – dan hanya kalau baris foto masih memegang jam hasil
--    revisi itu (tidak diubah lagi sesudahnya). Riwayat revisi tidak disentuh
--    (append-only); yang dibetulkan baris fotonya.
WITH terakhir AS (
  SELECT DISTINCT ON (r.photo_id)
    r.photo_id,
    (r.before ->> 'waktu')::timestamptz AS waktu_lama,
    (r.after ->> 'waktu')::timestamptz AS waktu_baru,
    r.before ->> 'sumberWaktu' AS sumber_lama,
    (r.before ->> 'jamDiketahui') = 'true' AND (r.after ->> 'jamDiketahui') = 'true' AS jam_tetap
  FROM "photo_stamp_revisions" r
  WHERE 'waktu' = ANY (r.manual_fields)
  ORDER BY r.photo_id, r.revision DESC
)
UPDATE "photos" p
SET "exif_taken_at" = t.waktu_lama,
    "metadata_source" = t.sumber_lama::"PhotoMetadataSource"
FROM terakhir t
WHERE p.id = t.photo_id
  AND t.jam_tetap
  AND t.waktu_lama <> t.waktu_baru
  AND date_trunc('minute', t.waktu_lama) = t.waktu_baru
  AND t.sumber_lama IN ('exif', 'device', 'filename', 'server', 'manual')
  AND p.metadata_source = 'manual'
  AND p.exif_taken_at = t.waktu_baru;

-- 2. Cap dibuat ulang di latar (pembaca susulan, DECISIONS 628) untuk foto yang
--    (a) membawa tulisan di pita atas foto – cap aplikasi kamera yang dulu bisa
--        tertimpa karena tidak ada susunan "semua di bawah"; atau
--    (b) jamnya baru saja dikembalikan di langkah 1 (cap lamanya mencetak jam
--        biru "manual" dan tanggal ganda).
--    Foto yang pernah diperbaiki tangan dengan isian yang SUNGGUH diketik
--    (nama, lokasi, koordinat, jam yang memang diganti) TIDAK ikut: pembaca
--    susulan merender dari data saat ini, jadi ketikan itu akan hilang. Foto
--    seperti itu diperbaiki ulang lewat tombol "Perbaiki cap".
UPDATE "photos" p
SET "ocr_pending" = true, "stamp_tries" = 0
WHERE p.stamp_pending = false
  AND p.original_key IS NOT NULL
  AND (
    (
      jsonb_typeof(p.text_boxes) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p.text_boxes) b
        WHERE (b ->> 'w')::float >= 0.08
          AND (b ->> 'y')::float + (b ->> 'h')::float / 2 <= 0.25
      )
    )
    OR EXISTS (
      SELECT 1 FROM "photo_stamp_revisions" r
      WHERE r.photo_id = p.id AND 'waktu' = ANY (r.manual_fields)
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "photo_stamp_revisions" r
    WHERE r.photo_id = p.id
      AND (
        cardinality(array_remove(r.manual_fields, 'waktu')) > 0
        OR (
          'waktu' = ANY (r.manual_fields)
          AND NOT COALESCE(
            (r.before ->> 'jamDiketahui') = 'true'
            AND (r.after ->> 'jamDiketahui') = 'true'
            AND (r.before ->> 'waktu')::timestamptz <> (r.after ->> 'waktu')::timestamptz
            AND date_trunc('minute', (r.before ->> 'waktu')::timestamptz) = (r.after ->> 'waktu')::timestamptz,
            false
          )
        )
      )
  );
