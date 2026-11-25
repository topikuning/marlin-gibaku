-- PEMASANGAN SESUDAH AKTIVASI: CATATAN PEKERJAAN DI LUAR RAB (DECISIONS 780)
--
-- Keluhan user 2026-11-25: "lalu jangan lupa ada pekerjaan-pekerjaan di luar
-- RAB yang sudah diinput manual, itu dimana matchingkan dengan RAB aktifnya?"
--
-- Usulan pemasangan kini juga bisa memuat catatan pekerjaan di luar RAB
-- (DECISIONS 738): catatan mana saja yang dipadankan ke item RAB aktif.
--
-- Idempoten (DECISIONS 167).

ALTER TABLE "rab_padanan_aktif" ADD COLUMN IF NOT EXISTS "luar_rab_ids" UUID[] NOT NULL DEFAULT '{}';
