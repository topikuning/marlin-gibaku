-- Pemakaian AI tanpa pengguna: tanya-jawab GRUP WhatsApp — DECISIONS 351.
--
-- Sejak jawaban grup tidak lagi menuntut pengirim terdaftar, ada pemakaian AI
-- yang sah tanpa pengguna. Mengisinya dengan pengguna karangan akan mencemari
-- audit (menunjuk orang yang tidak melakukan apa-apa) DAN kuota per-pengguna.
--
-- IF NOT EXISTS / DROP NOT NULL: Prisma menjalankan pernyataan SATU PER SATU,
-- jadi migrasi yang gagal di tengah harus aman diulang (DECISIONS 167).
ALTER TABLE "ai_runs" ALTER COLUMN "user_id" DROP NOT NULL;

-- Organisasi pemilik pemakaian. Kuota harian organisasi sebelumnya dihitung
-- lewat daftar id pengguna organisasi (`userId IN (...)`) — cara itu tidak bisa
-- menghitung run tanpa pengguna, dan daftarnya memanjang seiring jumlah akun.
ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "org_id" UUID;

-- Chat asal bila run dipicu dari grup — kunci pembatas laju penanya tak terdaftar.
ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "wa_chat_id" TEXT;

-- Isi org_id baris LAMA dari penggunanya, supaya kuota organisasi tidak
-- kehilangan riwayat begitu penghitungnya pindah ke kolom ini.
UPDATE "ai_runs" r
   SET "org_id" = u."org_id"
  FROM "users" u
 WHERE u."id" = r."user_id"
   AND r."org_id" IS NULL;

CREATE INDEX IF NOT EXISTS "ai_runs_org_id_created_at_idx" ON "ai_runs"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_runs_wa_chat_id_created_at_idx" ON "ai_runs"("wa_chat_id", "created_at");
