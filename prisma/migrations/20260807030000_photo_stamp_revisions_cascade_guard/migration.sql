-- Foto ber-riwayat cap MUSTAHIL dihapus — dua aturan yang saling bertabrakan.
--
-- Migrasi 20260801060000 memasang DUA hal yang tidak bisa hidup bersama, hanya
-- berjarak enam baris:
--
--   photo_stamp_revisions_photo_id_fkey ... ON DELETE CASCADE
--   CREATE TRIGGER photo_stamp_revisions_append_only BEFORE UPDATE OR DELETE ...
--
-- Menghapus foto memicu cascade ke baris revisi, trigger menolak DELETE, dan
-- seluruh aksi meledak dengan galat server (P0001) — bukan pesan yang bisa
-- dibaca, melainkan "A server error occurred".
--
-- Yang kena persis foto yang capnya PERNAH DILENGKAPI, yaitu foto Foto Cepat
-- yang ditautkan ke item lalu itemnya dihapus. Foto begitu jadi yatim di layar
-- laporan, tidak bisa dipakai, dan tidak bisa dihapus. Laporan user 2026-08-07.
--
-- PERBAIKAN, dan batasnya dijaga persis:
--
-- - UPDATE tetap DILARANG selamanya. Itu inti "append-only": koreksi cap =
--   INSERT revisi baru, bukan menimpa yang lama. Kalau baris lama bisa ditulis
--   ulang, catatan apa yang dulu tertera di foto jadi tak bisa dipercaya.
-- - DELETE hanya sah sebagai IKUTAN terhapusnya foto induk. Selama fotonya
--   masih ada, riwayat capnya tidak bisa dihapus — itu jaminan yang sama
--   seperti sebelumnya. Begitu fotonya sendiri hilang (hanya boleh saat laporan
--   draft/perlu-koreksi, hanya oleh pengunggah/SM/SA, dan dicatat di
--   audit_logs), riwayat cap sebuah foto yang tidak ada lagi tidak menjaga apa
--   pun.
--
-- Pembedanya dibaca dari kenyataan, bukan dari flag sesi: saat cascade berjalan,
-- baris induk di "photos" SUDAH terhapus dalam transaksi yang sama, sehingga
-- EXISTS di bawah bernilai false. DELETE langsung ke tabel revisi (fotonya masih
-- ada) tetap ditolak.

CREATE OR REPLACE FUNCTION marlin_photo_stamp_revisions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Tabel % append-only: UPDATE dilarang', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "photos" WHERE "id" = OLD."photo_id") THEN
    RAISE EXCEPTION 'Tabel % append-only: DELETE dilarang selama fotonya masih ada', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS photo_stamp_revisions_append_only ON "photo_stamp_revisions";
CREATE TRIGGER photo_stamp_revisions_append_only
  BEFORE UPDATE OR DELETE ON "photo_stamp_revisions"
  FOR EACH ROW EXECUTE FUNCTION marlin_photo_stamp_revisions_guard();
