-- KONTRAK TAHUN TUNGGAL SELESAI PALING LAMBAT 31 DESEMBER (DECISIONS 672).
--
-- Laporan user 2026-10-13: SPMK 18 September + 105 hari = 1 Januari, padahal
-- kontraknya bukan tahun jamak. Akhir kontrak = SPMK + durasi (DECISIONS 578)
-- tetap berlaku; yang ditambahkan batas tahun anggaran: kontrak tahun tunggal
-- dibatasi 31 Desember tahun SPMK. `tahun_jamak` = true melepas batas itu.
--
-- Bawaan false: seluruh kontrak yang ada adalah kontrak tahun tunggal.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "tahun_jamak" BOOLEAN NOT NULL DEFAULT false;

-- Kontrak tahun tunggal yang telanjur tersimpan melewati 31 Desember.
DROP TABLE IF EXISTS _kontrak_dibatasi;
CREATE TEMP TABLE _kontrak_dibatasi AS
SELECT
  c.id,
  c.package_id,
  c.start_date,
  c.week_mode,
  make_date(EXTRACT(YEAR FROM c.start_date)::int, 12, 31) AS akhir_baru
FROM contracts c
WHERE c.tahun_jamak = false
  AND c.start_date IS NOT NULL
  AND c.end_date IS NOT NULL
  AND c.end_date > make_date(EXTRACT(YEAR FROM c.start_date)::int, 12, 31);

UPDATE contracts c
SET end_date = k.akhir_baru
FROM _kontrak_dibatasi k
WHERE c.id = k.id;

-- Kolom minggu kurva-S ikut menyusut: hari yang terpotong (mis. 1 Januari)
-- dulu membuat satu kolom minggu sendiri. Penghitungnya sama dengan
-- `totalWeeksBetween` (progress-calc.ts) untuk kedua mode minggu.
DROP TABLE IF EXISTS _baseline_dipangkas;
CREATE TEMP TABLE _baseline_dipangkas AS
SELECT
  b.id AS baseline_id,
  CASE
    WHEN k.week_mode = 'senin_minggu' THEN
      FLOOR(
        (
          (k.akhir_baru - (EXTRACT(ISODOW FROM k.akhir_baru)::int - 1))
          - (k.start_date - (EXTRACT(ISODOW FROM k.start_date)::int - 1))
        ) / 7.0
      )::int + 1
    ELSE FLOOR((k.akhir_baru - k.start_date) / 7.0)::int + 1
  END AS diharapkan
FROM baselines b
JOIN locations l ON l.id = b.location_id
JOIN _kontrak_dibatasi k ON k.package_id = l.package_id;

-- Titik kumulatif: minggu terakhir yang tersisa mengambil nilai tertinggi dari
-- minggu yang dibuang (kurva monoton → nilai akhirnya, 100), lalu sisanya dibuang.
UPDATE baseline_points p
SET planned_pct = s.maks
FROM (
  SELECT p2.baseline_id, MAX(p2.planned_pct) AS maks
  FROM baseline_points p2
  JOIN _baseline_dipangkas t ON t.baseline_id = p2.baseline_id
  WHERE p2.week_number >= t.diharapkan
  GROUP BY p2.baseline_id
) s
JOIN _baseline_dipangkas t ON t.baseline_id = s.baseline_id
WHERE p.baseline_id = s.baseline_id
  AND p.week_number = t.diharapkan;

DELETE FROM baseline_points p
USING _baseline_dipangkas t
WHERE p.baseline_id = t.baseline_id
  AND p.week_number > t.diharapkan;

-- Matriks bobot per kategori: bobot minggu yang dibuang DIGABUNG ke minggu
-- terakhir yang tersisa, jadi Σ bobot tiap baris tidak berubah.
UPDATE baseline_schedule_items s
SET weekly = (
  SELECT jsonb_agg(
    CASE
      WHEN e.i < t.diharapkan THEN e.v
      ELSE to_jsonb((
        SELECT COALESCE(SUM(x.v::numeric), 0)
        FROM jsonb_array_elements_text(s.weekly) WITH ORDINALITY AS x(v, j)
        WHERE x.j >= t.diharapkan
      ))
    END
    ORDER BY e.i
  )
  FROM jsonb_array_elements(s.weekly) WITH ORDINALITY AS e(v, i)
  WHERE e.i <= t.diharapkan
)
FROM _baseline_dipangkas t
WHERE s.baseline_id = t.baseline_id
  AND jsonb_typeof(s.weekly) = 'array'
  AND jsonb_array_length(s.weekly) > t.diharapkan;

DROP TABLE IF EXISTS _baseline_dipangkas;
DROP TABLE IF EXISTS _kontrak_dibatasi;
