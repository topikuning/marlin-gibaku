-- Aturan EMPAT MATA untuk aktivasi revisi RAB (DECISIONS 234).
--
-- Mengaktifkan adendum mengganti RAB kontrak yang berlaku dan me-regenerate
-- kurva-S. Syaratnya dua orang BERBEDA: satu Program Director + satu peran
-- penugasan (AM/PM/SM). Super admin tidak bisa mengisi kursi mana pun.
--
-- Seluruh berkas ini wajib aman dijalankan ulang (DECISIONS 167).

-- Penanda perubahan draft. Editor SELALU menulis ulang total_value revisi tiap
-- mutasi, jadi kolom ini bergerak setiap isi draft berubah — dan persetujuan
-- yang diberikan sebelum perubahan terakhir otomatis gugur.
--
-- Ditambahkan NULLABLE dulu, baru diisi, baru dikunci. Bukan gaya-gayaan:
-- kalau kolomnya langsung NOT NULL DEFAULT now(), pengulangan migrasi (yang
-- BISA terjadi — Prisma menjalankan pernyataan satu per satu, tidak dalam satu
-- transaksi) akan menjalankan ulang backfill-nya dan MENARIK MUNDUR updated_at
-- revisi yang sudah diedit sejak migrasi. Efeknya persetujuan yang seharusnya
-- sudah gugur hidup kembali — persis lubang yang aturan empat mata ini tutup.
-- Dengan bentuk di bawah, backfill hanya menyentuh baris yang masih NULL.
ALTER TABLE "rab_revisions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;

-- Baris lama: samakan dengan created_at supaya tidak ada revisi yang terlihat
-- "baru diubah" hanya karena migrasi ini dijalankan.
UPDATE "rab_revisions" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

ALTER TABLE "rab_revisions" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "rab_revisions" ALTER COLUMN "updated_at" SET DEFAULT now();

CREATE TABLE IF NOT EXISTS "rab_revision_approvals" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "user_id"     UUID NOT NULL,
  "role"        "UserRole" NOT NULL,
  "total_value" BIGINT NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "rab_revision_approvals_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "rab_revisions"("id") ON DELETE CASCADE,
  CONSTRAINT "rab_revision_approvals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

-- Satu orang = satu tanda tangan per revisi. Menyetujui dua kali tidak boleh
-- terbaca sebagai dua kursi terisi.
CREATE UNIQUE INDEX IF NOT EXISTS "rab_revision_approvals_revision_id_user_id_key"
  ON "rab_revision_approvals" ("revision_id", "user_id");
CREATE INDEX IF NOT EXISTS "rab_revision_approvals_revision_id_idx"
  ON "rab_revision_approvals" ("revision_id");
