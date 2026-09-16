-- LOKASI BER-RIWAYAT STATUS MUSTAHIL DICABUT — dua aturan yang bertabrakan.
--
-- Konversi kontrak menulis satu baris `location_status_history` ("persiapan")
-- untuk SETIAP lokasi paket. Sementara itu tabel itu append-only (migrasi
-- 20260714005500) dan kunci asingnya `Restrict`. Akibatnya lokasi yang keliru
-- ikut terkonversi TIDAK BISA dikeluarkan lewat layar mana pun: kunci asing
-- menolak lebih dulu, dan kalaupun tidak, triggernya yang menolak.
--
-- Kasus nyata user 2026-09-16: desa Kemadang berjalan di Paket A, lalu ikut
-- terpilih sebagai lokasi awal Paket B, dan Paket B keburu dikonversi ke
-- kontrak. Yang di Paket B kosong — tidak ada RAB, laporan, maupun foto — tapi
-- tidak bisa dibuang, dan selama ia ada, pemindahan Kemadang dari A ke B
-- ditolak guard nama kembar (DECISIONS 581). Buntu di kedua arah.
--
-- PERBAIKANNYA MENIRU PRESEDEN YANG SUDAH ADA di repo ini untuk persoalan yang
-- bentuknya sama persis — `photo_stamp_revisions` (migrasi 20260807030000), dan
-- batasnya dijaga sama ketatnya:
--
-- - UPDATE tetap DILARANG selamanya. Itu inti "append-only": koreksi status =
--   INSERT baris baru, bukan menimpa yang lama. Kalau baris lama bisa ditulis
--   ulang, kapan sebuah lokasi berpindah status jadi tidak bisa dipercaya.
-- - DELETE hanya sah sebagai IKUTAN terhapusnya LOKASI induk. Selama lokasinya
--   masih ada, riwayat statusnya tidak bisa disentuh — jaminan yang sama persis
--   seperti sebelumnya. Begitu lokasinya sendiri hilang (hanya lewat
--   `correctRemoveLocationAction`: super_admin, wajib alasan, hanya untuk
--   lokasi yang benar-benar kosong, dan tercatat di `package_stage_history`
--   maupun `audit_logs` SEBELUM penghapusannya), riwayat status sebuah lokasi
--   yang tidak ada lagi tidak menjaga apa pun.
--
-- Pembedanya dibaca dari kenyataan, bukan dari flag sesi: saat cascade berjalan,
-- baris induk di "locations" SUDAH terhapus dalam transaksi yang sama, sehingga
-- EXISTS di bawah bernilai false. DELETE langsung ke tabel riwayat (lokasinya
-- masih ada) tetap ditolak.
--
-- Jejak koreksinya sendiri TIDAK ikut hilang: `package_stage_history` dan
-- `audit_logs` memuat NAMA lokasinya, bukan hanya UUID-nya, justru supaya masih
-- terbaca sesudah barisnya tiada.

-- 1. Kunci asing: Restrict → Cascade (idempoten).
ALTER TABLE "location_status_history"
  DROP CONSTRAINT IF EXISTS "location_status_history_location_id_fkey";
ALTER TABLE "location_status_history"
  ADD CONSTRAINT "location_status_history_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Trigger: UPDATE dilarang selamanya, DELETE hanya sebagai ikutan.
CREATE OR REPLACE FUNCTION marlin_location_status_history_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Tabel % append-only: UPDATE dilarang', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "locations" WHERE "id" = OLD."location_id") THEN
    RAISE EXCEPTION 'Tabel % append-only: DELETE dilarang selama lokasinya masih ada', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS location_status_history_append_only ON "location_status_history";
CREATE TRIGGER location_status_history_append_only
  BEFORE UPDATE OR DELETE ON "location_status_history"
  FOR EACH ROW EXECUTE FUNCTION marlin_location_status_history_guard();
