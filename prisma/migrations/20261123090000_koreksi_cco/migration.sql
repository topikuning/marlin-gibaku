-- KOREKSI CCO (DECISIONS 771)
--
-- Permintaan user 2026-11-23: "bagaimana jika aku mencatat cco, tapi kemudian
-- aku salah info, bagaimana mengeditnya?"
--
-- Sejak rebuild (append_only_triggers) baris CCO tidak boleh diubah sama sekali.
-- Sekarang ISIAN DOKUMEN-nya boleh dikoreksi – nomor, nilai resmi, perubahan
-- waktu, tanggal berlaku, alasan – dengan dua pagar di basis data:
-- 1. sebelum baris berubah, isian LAMA disalin trigger ke
--    contract_amendment_history (append-only), jadi tak ada koreksi tanpa jejak;
-- 2. identitas & turunan (id, kontrak, nilai turunan RAB, pembuat, waktu catat)
--    tetap tidak boleh diubah, dan baris CCO tetap tidak boleh DIHAPUS.
--
-- Idempoten (DECISIONS 167).

CREATE TABLE IF NOT EXISTS "contract_amendment_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "amendment_id" UUID NOT NULL,
  "cco_number" TEXT NOT NULL,
  "value_delta" BIGINT NOT NULL,
  "end_date_delta" INTEGER NOT NULL,
  "effective_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "replaced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_amendment_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contract_amendment_history_amendment_id_replaced_at_idx"
  ON "contract_amendment_history"("amendment_id", "replaced_at");

ALTER TABLE "contract_amendment_history" DROP CONSTRAINT IF EXISTS "contract_amendment_history_amendment_id_fkey";
ALTER TABLE "contract_amendment_history"
  ADD CONSTRAINT "contract_amendment_history_amendment_id_fkey"
  FOREIGN KEY ("amendment_id") REFERENCES "contract_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS contract_amendment_history_append_only ON "contract_amendment_history";
CREATE TRIGGER contract_amendment_history_append_only
  BEFORE UPDATE OR DELETE ON "contract_amendment_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

CREATE OR REPLACE FUNCTION marlin_cco_koreksi() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tabel % append-only: CCO tidak boleh dihapus', TG_TABLE_NAME;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.value_delta_rab IS DISTINCT FROM OLD.value_delta_rab
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CCO hanya boleh dikoreksi isian dokumennya (nomor, nilai resmi, waktu, tanggal berlaku, alasan)';
  END IF;
  IF NEW.cco_number IS DISTINCT FROM OLD.cco_number
     OR NEW.value_delta IS DISTINCT FROM OLD.value_delta
     OR NEW.end_date_delta IS DISTINCT FROM OLD.end_date_delta
     OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    INSERT INTO "contract_amendment_history"
      ("amendment_id", "cco_number", "value_delta", "end_date_delta", "effective_date", "reason")
    VALUES (OLD.id, OLD.cco_number, OLD.value_delta, OLD.end_date_delta, OLD.effective_date, OLD.reason);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contract_amendments_append_only ON "contract_amendments";
DROP TRIGGER IF EXISTS contract_amendments_koreksi ON "contract_amendments";
CREATE TRIGGER contract_amendments_koreksi
  BEFORE UPDATE OR DELETE ON "contract_amendments"
  FOR EACH ROW EXECUTE FUNCTION marlin_cco_koreksi();
