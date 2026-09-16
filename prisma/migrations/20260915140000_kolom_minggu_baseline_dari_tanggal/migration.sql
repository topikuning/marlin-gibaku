-- KOLOM MINGGU BASELINE MENGIKUTI PASANGAN (SPMK, AKHIR KONTRAK) YANG TERSIMPAN.
--
-- `totalWeeksFor` dulu menghitung kolom minggu mode `tujuh_hari` dari
-- ceil(durasi/7), sedangkan laporan periodik memakai totalWeeksBetween atas
-- (start_date, end_date). Keduanya hanya sama bila durasi TIDAK habis dibagi 7;
-- pada durasi kelipatan 7 baseline dibuat SATU kolom lebih pendek daripada grid
-- laporan, sehingga kolom minggu terakhir blanko KKP tidak punya titik rencana
-- sama sekali. Keputusan user 2026-09-15: akhir kontrak = SPMK + durasi, jadi
-- yang dibetulkan penghitung kolomnya. Audit 2026-09-15 (G-2).
--
-- Baseline yang sudah tersimpan ikut dipanjangkan di sini — kurvanya TIDAK
-- diubah bentuknya: minggu tambahan mewarisi nilai kumulatif minggu terakhir
-- (tetap monoton, tetap berakhir 100), dan matriks per kategori ditambah kolom
-- NOL (Σ bobot tiap baris tidak berubah).
--
-- Idempoten: menghitung selisih dari keadaan sekarang, jadi menjalankannya dua
-- kali tidak menambah kolom dua kali.
WITH target AS (
  SELECT
    b.id AS baseline_id,
    (FLOOR((c.end_date - c.start_date) / 7.0)::int + 1) AS diharapkan,
    COUNT(p.id)::int AS sekarang,
    MAX(p.week_number) AS minggu_terakhir
  FROM baselines b
  JOIN locations l ON l.id = b.location_id
  JOIN contracts c ON c.package_id = l.package_id
  LEFT JOIN baseline_points p ON p.baseline_id = b.id
  WHERE c.week_mode = 'tujuh_hari'
    AND c.start_date IS NOT NULL
    AND c.end_date IS NOT NULL
    AND c.end_date >= c.start_date
  GROUP BY b.id, c.start_date, c.end_date
  HAVING COUNT(p.id) > 0
     AND COUNT(p.id) < (FLOOR((c.end_date - c.start_date) / 7.0)::int + 1)
),
-- Nilai kumulatif minggu terakhir, diwariskan ke minggu tambahan.
nilai_akhir AS (
  SELECT t.baseline_id, t.diharapkan, t.sekarang, p.planned_pct
  FROM target t
  JOIN baseline_points p
    ON p.baseline_id = t.baseline_id AND p.week_number = t.minggu_terakhir
),
tambah_titik AS (
  INSERT INTO baseline_points (id, baseline_id, week_number, planned_pct)
  SELECT gen_random_uuid(), n.baseline_id, w, n.planned_pct
  FROM nilai_akhir n
  CROSS JOIN LATERAL generate_series(n.sekarang + 1, n.diharapkan) AS w
  RETURNING baseline_id
)
UPDATE baseline_schedule_items s
SET weekly = s.weekly || (
  SELECT COALESCE(jsonb_agg(0), '[]'::jsonb)
  FROM generate_series(1, t.diharapkan - jsonb_array_length(s.weekly))
)
FROM target t
WHERE s.baseline_id = t.baseline_id
  AND jsonb_typeof(s.weekly) = 'array'
  AND jsonb_array_length(s.weekly) > 0
  AND jsonb_array_length(s.weekly) < t.diharapkan;
