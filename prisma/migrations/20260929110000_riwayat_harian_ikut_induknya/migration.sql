-- DECISIONS 630: reset laporan harian satu lokasi.
--
-- Tiga riwayat append-only menempel ke data yang kini boleh dihapus super
-- admin utama: riwayat status laporan harian, riwayat status temuan, dan
-- verifikasi Wakil PPK. Polanya sama persis dengan photo_stamp_revisions
-- (20260807) dan location_status_history (20260916):
--
-- - UPDATE tetap DILARANG selamanya.
-- - DELETE hanya sah sebagai IKUTAN terhapusnya induk (kunci asing CASCADE).
--   Selama induknya masih ada, riwayatnya tidak bisa dihapus. Pembedanya
--   dibaca dari kenyataan: saat cascade berjalan, baris induk SUDAH terhapus
--   dalam transaksi yang sama.

ALTER TABLE "daily_report_status_history"
  DROP CONSTRAINT IF EXISTS "daily_report_status_history_report_id_fkey";
ALTER TABLE "daily_report_status_history"
  ADD CONSTRAINT "daily_report_status_history_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_verifications"
  DROP CONSTRAINT IF EXISTS "report_verifications_report_id_fkey";
ALTER TABLE "report_verifications"
  ADD CONSTRAINT "report_verifications_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finding_status_history"
  DROP CONSTRAINT IF EXISTS "finding_status_history_finding_id_fkey";
ALTER TABLE "finding_status_history"
  ADD CONSTRAINT "finding_status_history_finding_id_fkey"
  FOREIGN KEY ("finding_id") REFERENCES "findings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION marlin_riwayat_laporan_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Tabel % append-only: UPDATE dilarang', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "daily_reports" WHERE "id" = OLD."report_id") THEN
    RAISE EXCEPTION 'Tabel % append-only: DELETE dilarang selama laporannya masih ada', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION marlin_riwayat_temuan_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Tabel % append-only: UPDATE dilarang', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "findings" WHERE "id" = OLD."finding_id") THEN
    RAISE EXCEPTION 'Tabel % append-only: DELETE dilarang selama temuannya masih ada', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_report_status_history_append_only ON "daily_report_status_history";
CREATE TRIGGER daily_report_status_history_append_only
  BEFORE UPDATE OR DELETE ON "daily_report_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_riwayat_laporan_guard();

DROP TRIGGER IF EXISTS report_verifications_append_only ON "report_verifications";
CREATE TRIGGER report_verifications_append_only
  BEFORE UPDATE OR DELETE ON "report_verifications"
  FOR EACH ROW EXECUTE FUNCTION marlin_riwayat_laporan_guard();

DROP TRIGGER IF EXISTS finding_status_history_append_only ON "finding_status_history";
CREATE TRIGGER finding_status_history_append_only
  BEFORE UPDATE OR DELETE ON "finding_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_riwayat_temuan_guard();
