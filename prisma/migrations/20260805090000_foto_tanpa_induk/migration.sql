-- FOTO CEPAT: foto boleh BELUM punya induk (DECISIONS 253).
--
-- Invarian lama (DATA-01, migrasi 20260728020000) menuntut TEPAT SATU induk:
-- laporan harian ATAU kegiatan lapangan. Waktu itu benar — satu-satunya jalan
-- masuk foto memang lewat salah satu dari keduanya, jadi foto tanpa induk pasti
-- berarti data rusak.
--
-- Foto Cepat mengubah premisnya: foto sengaja disimpan LEBIH DULU (berikut
-- koordinat & jam pada detik jepret), itemnya dipilih belakangan. "Nol induk"
-- kini keadaan yang sah dan bernama — "Belum Dipakai".
--
-- Yang TIDAK dilonggarkan, dan justru itu inti constraint-nya:
--   * DUA induk sekaligus tetap dilarang (foto tidak boleh jadi lampiran
--     laporan sekaligus kegiatan — dua kebenaran yang bisa berbeda);
--   * `report_item_id` tetap menuntut `report_id` (constraint terpisah,
--     tidak disentuh).
ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_parent_xor_ck";
ALTER TABLE "photos"
  ADD CONSTRAINT "photos_parent_xor_ck" CHECK (
  (("report_id" IS NOT NULL)::int + ("activity_id" IS NOT NULL)::int) <= 1
);
