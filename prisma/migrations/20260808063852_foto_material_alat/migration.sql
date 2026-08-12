-- Bukti foto untuk baris MATERIAL / ALAT di laporan harian (DECISIONS 304).
--
-- IDEMPOTEN (DECISIONS 167): Prisma menjalankan pernyataan satu per satu, bukan
-- dalam satu transaksi. Kalau pernyataan ke-N gagal, 1..N-1 tetap tersimpan dan
-- migrasi ini memblokir semua deploy berikutnya sampai bisa dijalankan ulang.
--
-- ON DELETE SET NULL, sama seperti report_item_id: baris material yang dihapus
-- TIDAK ikut menghapus fotonya. Fotonya jadi yatim yang masih bisa dilihat dan
-- dibersihkan — bukti tidak boleh lenyap diam-diam gara-gara satu baris disunting.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "report_material_id"  UUID;
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "report_equipment_id" UUID;

CREATE INDEX IF NOT EXISTS "photos_report_material_id_idx"  ON "photos"("report_material_id");
CREATE INDEX IF NOT EXISTS "photos_report_equipment_id_idx" ON "photos"("report_equipment_id");

ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_report_material_id_fkey";
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_material_id_fkey"
  FOREIGN KEY ("report_material_id") REFERENCES "daily_report_materials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "photos" DROP CONSTRAINT IF EXISTS "photos_report_equipment_id_fkey";
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_equipment_id_fkey"
  FOREIGN KEY ("report_equipment_id") REFERENCES "daily_report_equipment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
