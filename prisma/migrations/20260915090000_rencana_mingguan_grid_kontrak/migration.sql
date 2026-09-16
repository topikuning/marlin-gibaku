-- Rentang minggu RENCANA MINGGUAN mengikuti GRID KONTRAK (`week_mode`).
--
-- Penulisnya dulu memakai aritmetika tujuh-hari dari SPMK, sedangkan seluruh
-- lapisan hitung memakai grid kontrak. Pada mode `senin_minggu` — default —
-- keduanya hanya sama bila SPMK jatuh Senin. Rentang yang telanjur tersimpan
-- masih dibaca oleh blanko harian (weekStart<=tanggal<=weekEnd), PPC minggu
-- lalu, dan tab Rencana, jadi ia harus ikut dibetulkan; kalau tidak, satu
-- sistem tetap menyebut dua rentang untuk nomor minggu yang sama.
-- Audit 2026-09-15 (G-3).
--
-- Idempoten: menghitung ulang dari kontrak, bukan menggeser nilai yang ada.
UPDATE weekly_plans wp
SET week_start = g.ws,
    week_end = g.we,
    updated_at = now()
FROM (
  SELECT
    p.id,
    GREATEST(
      c.start_date,
      CASE
        WHEN c.week_mode = 'senin_minggu'
          THEN (date_trunc('week', c.start_date::timestamp)::date + (p.week_number - 1) * 7)
        ELSE (c.start_date + (p.week_number - 1) * 7)
      END
    ) AS ws,
    LEAST(
      COALESCE(c.end_date, DATE '9999-12-31'),
      GREATEST(
        c.start_date,
        CASE
          WHEN c.week_mode = 'senin_minggu'
            THEN (date_trunc('week', c.start_date::timestamp)::date + (p.week_number - 1) * 7)
          ELSE (c.start_date + (p.week_number - 1) * 7)
        END
      ) + 6
    ) AS we
  FROM weekly_plans p
  JOIN locations l ON l.id = p.location_id
  JOIN contracts c ON c.package_id = l.package_id
  WHERE c.start_date IS NOT NULL
) AS g
WHERE g.id = wp.id
  AND (wp.week_start <> g.ws OR wp.week_end <> g.we)
  -- Jangan menaikkan akhir minggu melewati akhir kontrak menjadi lebih kecil
  -- dari awalnya (kontrak yang end_date-nya lebih awal dari minggu itu).
  AND g.we >= g.ws;
