-- Append-only enforcement: koreksi = INSERT baru, bukan UPDATE/DELETE.
CREATE OR REPLACE FUNCTION marlin_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % append-only: UPDATE/DELETE dilarang', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER package_stage_history_append_only
  BEFORE UPDATE OR DELETE ON "package_stage_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

CREATE TRIGGER location_status_history_append_only
  BEFORE UPDATE OR DELETE ON "location_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

CREATE TRIGGER daily_report_status_history_append_only
  BEFORE UPDATE OR DELETE ON "daily_report_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

CREATE TRIGGER contract_amendments_append_only
  BEFORE UPDATE OR DELETE ON "contract_amendments"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();
