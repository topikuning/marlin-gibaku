-- HARI TANPA KEGIATAN (DECISIONS 396).
--
-- Kebutuhan user 2026-08-20: "dalam satu hari di laporan harian itu, dalam hari
-- ini tidak ada kegiatan. jadi item pekerjaan tidak harus diisi."
--
-- Yang ditambahkan BUKAN pelonggaran pagar melainkan PERNYATAAN. Kalau pagarnya
-- sekadar dilonggarkan, laporan yang lupa diisi tidak bisa dibedakan dari hari
-- yang memang nihil — dua hal yang berlawanan artinya.
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

-- PostgreSQL tidak punya CREATE TYPE IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NoActivityReason') THEN
    CREATE TYPE "NoActivityReason" AS ENUM (
      'hujan', 'libur', 'menunggu_material', 'menunggu_lahan_izin',
      'force_majeure', 'lainnya'
    );
  END IF;
END $$;

ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "no_activity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "no_activity_reason" "NoActivityReason";
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "no_activity_note" TEXT;

-- Laporan LAMA tidak di-backfill jadi nihil, walaupun kebetulan tanpa item.
-- Menandainya nihil berarti MENGARANG pernyataan yang tidak pernah dibuat
-- siapa pun — persis kebalikan dari gunanya kolom ini.

CREATE INDEX IF NOT EXISTS "daily_reports_location_id_no_activity_report_date_idx"
  ON "daily_reports"("location_id", "no_activity", "report_date");
