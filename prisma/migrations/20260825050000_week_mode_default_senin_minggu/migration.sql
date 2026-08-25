-- Kesepakatan user 2026-08-25 (DECISIONS 429): default mode periode minggu
-- adalah SENIN–MINGGU (M1 menyesuaikan). Kontrak BARU otomatis memakainya.
-- Kontrak lama dikonversi otomatis saat boot server (lihat
-- src/lib/migrasi/mode-minggu-default.ts) karena konversi baselinenya butuh
-- formula TS (rebucketWeeklyToGrid) yang tidak boleh diduplikasi di SQL.
ALTER TABLE "contracts" ALTER COLUMN "week_mode" SET DEFAULT 'senin_minggu';
