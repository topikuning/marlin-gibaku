-- MENGGABUNGKAN KENDALA KEMBAR (DECISIONS 393).
--
-- Penjaga duplikat (DECISIONS 392) menahan kembar BARU di pintu masuk, tapi
-- tidak bisa merapikan yang terlanjur ada. Tangkapan layar user memuat "Lahan
-- belum bisa clear" TIGA KALI — tanggal sama, tingkat sama, ketiganya terbuka.
--
-- Penggabungan sengaja TIDAK menghapus baris apa pun: baris kembarnya tetap
-- ada berikut riwayat dan aksinya, hanya berhenti dihitung dan berhenti muncul.
-- Menghapus akan membuat audit menunjuk ke baris yang tidak ada lagi, dan
-- membatalkan penggabungan yang salah jadi mustahil.
--
-- Idempoten: aman dijalankan ulang setelah deploy yang gagal separuh jalan.

ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "merged_into_id" UUID;

-- FK ke tabelnya sendiri. DROP dulu, bukan dibungkus DO ... IF NOT EXISTS:
-- itulah bentuk yang dikenali `alasanTidakIdempoten` di scripts/migrate-deploy.mjs,
-- dan menyesuaikan migrasi ke penjaganya lebih benar daripada melonggarkan
-- penjaganya untuk satu berkas. Murah di sini karena `issues` tabel kecil.
ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_merged_into_id_fkey";
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_merged_into_id_fkey"
  FOREIGN KEY ("merged_into_id") REFERENCES "issues"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "issues_merged_into_id_idx" ON "issues"("merged_into_id");
