-- Identitas privasi WhatsApp (@lid) per pengguna — DECISIONS 347.
--
-- WhatsApp mengirim sebagian chat dengan JID `…@lid` yang TIDAK memuat nomor
-- telepon. Tanpa pemetaan ini, penanya yang chat-nya ber-@lid tidak bisa
-- dikenali sama sekali, dan chat pribadi dari nomor tak dikenal memang sengaja
-- didiamkan — gejalanya "tidak ada respon", tanpa galat.
-- IF NOT EXISTS: Prisma menjalankan pernyataan SATU PER SATU, jadi migrasi
-- yang gagal di tengah harus aman diulang (DECISIONS 167).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wa_lid" TEXT;

-- Dicari saat setiap pesan masuk, jadi diindeks. Tidak UNIQUE: dua akun boleh
-- terlanjur memakai LID yang sama, dan penanganannya (tidak dijawab, minta
-- datanya dibetulkan) sudah ada di lapisan aplikasi — menolaknya di DB akan
-- menggagalkan penyimpanan pengguna, bukan menolong.
CREATE INDEX IF NOT EXISTS "users_wa_lid_idx" ON "users"("wa_lid");
