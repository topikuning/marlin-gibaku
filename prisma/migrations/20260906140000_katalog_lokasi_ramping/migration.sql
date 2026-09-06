-- KATALOG LOKASI DIRAMPINGKAN: hanya yang dipakai MARLIN.
--
-- Teguran user 2026-09-06 setelah melihat blok "Dari berkas sumber" di layar
-- sunting katalog: *"siapa yang memintamu menambahkan informasi ini? aku sudah
-- bilang sesuaikan dengan kebutuhan yang ada di marlin saja!"*
--
-- Migrasi 20260906020000 sempat menambahkan belasan kolom dari berkas MASTER
-- DATA KNMP yang tidak dibaca layar mana pun. Berkas migrasi itu TIDAK diubah —
-- ia sudah dijalankan, dan mengubah isinya membuat checksum `migrate deploy`
-- tidak cocok di basis data yang sudah menerapkannya. Yang benar: satu migrasi
-- baru yang membuang kolomnya.
--
-- Yang TETAP: name (nama kampung nelayan), updated_at, dan seluruh kolom lama.
-- Kolom status lokasi tetap DIBACA saat impor untuk menyaring yang aktif,
-- tapi tidak lagi disimpan.
--
-- Idempoten (DECISIONS 167).

DROP INDEX IF EXISTS "master_locations_org_id_source_code_idx";

ALTER TABLE "master_locations"
  DROP COLUMN IF EXISTS "source_code",
  DROP COLUMN IF EXISTS "region",
  DROP COLUMN IF EXISTS "cluster",
  DROP COLUMN IF EXISTS "pleno_result",
  DROP COLUMN IF EXISTS "status_code",
  DROP COLUMN IF EXISTS "status_label",
  DROP COLUMN IF EXISTS "status_reason",
  DROP COLUMN IF EXISTS "coordinate_status",
  DROP COLUMN IF EXISTS "source_batch",
  DROP COLUMN IF EXISTS "land_area_ha",
  DROP COLUMN IF EXISTS "fishermen_count",
  DROP COLUMN IF EXISTS "boats_no_engine",
  DROP COLUMN IF EXISTS "boats_engine",
  DROP COLUMN IF EXISTS "boats_total",
  DROP COLUMN IF EXISTS "ee_value";
