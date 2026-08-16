-- Padanan item RAB → analisa AHSP (DECISIONS 319).
--
-- IDEMPOTEN dengan sengaja: Prisma menjalankan pernyataan migrasi SATU PER SATU,
-- BUKAN dalam satu transaksi (DECISIONS 167). Kalau baris ke-N gagal, baris
-- 1..N-1 tetap tersimpan — jadi menjalankan ulang berkas ini harus aman.

CREATE TABLE IF NOT EXISTS "ahsp_padanan" (
    "id"            UUID         NOT NULL,
    "tanda"         TEXT         NOT NULL,
    "uraian_contoh" TEXT         NOT NULL,
    "satuan"        TEXT         NOT NULL,
    "entry_id"      UUID,
    "metode"        TEXT         NOT NULL,
    "skor"          DECIMAL(5,4),
    "meyakinkan"    BOOLEAN      NOT NULL DEFAULT false,
    "catatan"       TEXT,
    "decided_by_id" UUID,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ahsp_padanan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ahsp_padanan_tanda_key" ON "ahsp_padanan" ("tanda");
CREATE INDEX IF NOT EXISTS "ahsp_padanan_entry_id_idx" ON "ahsp_padanan" ("entry_id");
CREATE INDEX IF NOT EXISTS "ahsp_padanan_metode_idx" ON "ahsp_padanan" ("metode");

-- ON DELETE SET NULL, BUKAN CASCADE: kalau terbitan AHSP diganti dan analisanya
-- hilang, koreksi manusia tidak boleh ikut terhapus diam-diam. Barisnya tetap
-- ada dengan entry_id kosong sehingga terlihat sebagai padanan yang perlu
-- ditinjau ulang, bukan sebagai baris yang tidak pernah ada.
ALTER TABLE "ahsp_padanan" DROP CONSTRAINT IF EXISTS "ahsp_padanan_entry_id_fkey";
ALTER TABLE "ahsp_padanan" ADD CONSTRAINT "ahsp_padanan_entry_id_fkey"
    FOREIGN KEY ("entry_id") REFERENCES "ahsp_entries" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ahsp_padanan" DROP CONSTRAINT IF EXISTS "ahsp_padanan_decided_by_id_fkey";
ALTER TABLE "ahsp_padanan" ADD CONSTRAINT "ahsp_padanan_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
