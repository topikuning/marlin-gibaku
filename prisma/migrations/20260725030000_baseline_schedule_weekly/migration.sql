-- BaselineScheduleItem: ganti jendela tunggal (start_week/end_week) → matriks
-- bobot per-minggu (weekly JSONB) supaya mendukung minggu TERPUTUS (jeda) &
-- round-trip Excel. DECISIONS 103.

-- 1) Kolom baru (default '[]' agar aman utk baris lama sebelum backfill).
ALTER TABLE "baseline_schedule_items"
  ADD COLUMN "weekly" JSONB NOT NULL DEFAULT '[]';

-- 2) Backfill dari jendela lama: sebar bobot RATA di [start_week..end_week],
--    0 di luar jendela; panjang array = totalWeeks (ceil(contract_days/7)).
--    (Nilai lonceng eksak muncul saat "Hitung ulang"/simpan editor berikutnya.)
UPDATE "baseline_schedule_items" i
SET "weekly" = sub.arr
FROM (
  SELECT
    i2."id" AS id,
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN g.w BETWEEN i2."start_week" AND i2."end_week"
              THEN round(
                (i2."weight_pct" / GREATEST(1, (i2."end_week" - i2."start_week" + 1)))::numeric,
                6
              )
            ELSE 0
          END
          ORDER BY g.w
        )
        FROM generate_series(1, GREATEST(1, CEIL(b."contract_days"::numeric / 7)::int)) AS g(w)
      ),
      '[]'::jsonb
    ) AS arr
  FROM "baseline_schedule_items" i2
  JOIN "baselines" b ON b."id" = i2."baseline_id"
) sub
WHERE i."id" = sub.id;

-- 3) Buang kolom lama.
ALTER TABLE "baseline_schedule_items" DROP COLUMN "start_week";
ALTER TABLE "baseline_schedule_items" DROP COLUMN "end_week";
