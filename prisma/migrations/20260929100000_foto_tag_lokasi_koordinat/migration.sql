-- DECISIONS 629: tag lokasi bawaan kamera kini HANYA koordinat. Foto yang
-- dulu dianggap sudah ber-tag lokasi (sering cuma nama wilayah + tanggal)
-- dibaca ulang dari berkas asli oleh pembaca susulan (628) dan dicap ulang
-- dengan aturan baru. Foto yang capnya sudah diperbaiki tangan tidak disentuh.
UPDATE "photos"
SET "ocr_pending" = true, "stamp_tries" = 0
WHERE "existing_tag_location" = true
  AND "stamp_revision" = 0
  AND "stamp_pending" = false
  AND "original_key" IS NOT NULL;
