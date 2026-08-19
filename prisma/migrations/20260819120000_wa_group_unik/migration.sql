-- SATU GRUP WHATSAPP HANYA BOLEH MILIK SATU PAKET (DECISIONS 370 & 373).
--
-- Sebelum ini `packages.wa_group_id` tanpa batasan apa pun, sementara
-- pembacaannya memakai `findFirst()` atas beberapa varian tulisan. Dua paket
-- yang menunjuk grup sama membuat paket mana yang menjawab ditentukan urutan
-- baris — data paket A bisa terkirim ke grup paket B, tanpa galat apa pun.
--
-- ### Kenapa migrasi ini MEMBERESKAN, bukan menolak
--
-- Versi pertama migrasi ini MENOLAK berjalan bila menemukan duplikat, supaya
-- manusia yang memutuskan paket mana yang berhak. Niatnya benar, akibatnya
-- tidak: deploy Railway mentok, dan orang yang harus memutuskan justru tidak
-- punya akses menjalankan perintah apa pun ke basis data itu. Pagar yang
-- mengunci pintu dari luar bukan pagar, melainkan kerusakan kedua.
--
-- Yang menentukan bukan selera melainkan satu kenyataan: keadaan SEBELUM
-- migrasi ini sudah rusak, dan rusaknya lebih parah. Dengan dua paket menunjuk
-- satu grup, pemenangnya dipilih ulang setiap kueri oleh urutan baris — tidak
-- deterministik, tidak tercatat, tidak terlihat. Migrasi ini memilih SEKALI,
-- dengan bukti, dan menuliskan pilihannya ke audit yang append-only. Itu tidak
-- mungkin lebih buruk daripada yang sudah berjalan.
--
-- Tidak ada yang dihapus. `wa_group_id` cuma penunjuk; melepasnya tidak
-- menyentuh paket, lokasi, laporan, maupun arsip pesan. Dan karena nilainya
-- ikut tercatat di audit, tautannya bisa dikembalikan admin kapan saja.

-- 1. Kanonikkan bentuk yang tersimpan.
--
--    Cerminan `kanonikGrupId()` di src/lib/waha/grup-id.ts untuk bentuk yang
--    BISA tersimpan lewat jalur aplikasi lama:
--      - spasi di tepi dibuang;
--      - sufiks perangkat/agen pada bagian lokal (`:12`, `_1`) dibuang;
--      - domain dikecilkan; `s.whatsapp.net` disatukan ke `c.us`;
--      - tanpa domain → `@g.us`.
UPDATE packages
SET wa_group_id = CASE
  WHEN position('@' IN btrim(wa_group_id)) = 0
    THEN regexp_replace(btrim(wa_group_id), '[:_].*$', '') || '@g.us'
  ELSE regexp_replace(split_part(btrim(wa_group_id), '@', 1), '[:_].*$', '')
       || '@'
       || CASE lower(split_part(btrim(wa_group_id), '@', 2))
            WHEN 's.whatsapp.net' THEN 'c.us'
            ELSE lower(split_part(btrim(wa_group_id), '@', 2))
          END
END
WHERE wa_group_id IS NOT NULL AND btrim(wa_group_id) <> '';

-- Nilai yang setelah dibersihkan jadi kosong bukan tautan, melainkan sampah.
UPDATE packages SET wa_group_id = NULL
WHERE wa_group_id IS NOT NULL AND (btrim(wa_group_id) = '' OR wa_group_id = '@g.us');

-- 2. Duplikat DICATAT dulu — sebelum apa pun dilepas.
--
--    Urutannya penting: kalau pelepasan didahulukan lalu pencatatan gagal,
--    tautan yang hilang tidak meninggalkan jejak sama sekali.
--
--    Pemenangnya dipilih dari BUKTI PEMAKAIAN, berurutan:
--      a. paling banyak arsip pesan WhatsApp — penunjuk terkuat "grup ini
--         sebenarnya mengalirkan pesan ke paket yang mana";
--      b. paling banyak lokasi aktif;
--      c. paling tua — pemutus terakhir yang stabil, supaya hasilnya sama
--         berapa kali pun dijalankan.
INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, payload, created_at)
SELECT gen_random_uuid(), NULL, 'package.wa_group_auto_unlink', 'package', kalah.id::text,
       jsonb_build_object(
         'waGroupId',   kalah.wa_group_id,
         'migrasi',     '20260819120000_wa_group_unik',
         'alasan',      'Grup ini tertaut ke lebih dari satu paket. Tautan dilepas otomatis supaya satu grup hanya milik satu paket.',
         'pesanWa',     kalah.pesan,
         'lokasiAktif', kalah.lokasi,
         'pemenangId',  kalah.pemenang_id,
         'pemenang',    (SELECT name FROM packages w WHERE w.id = kalah.pemenang_id),
         'pulihkan',    'Untuk mengembalikan: Paket → buka paket ini → Grup WhatsApp → isi waGroupId di atas.'
       ),
       now()
FROM (
  SELECT id, wa_group_id, pesan, lokasi,
         first_value(id) OVER w AS pemenang_id,
         row_number()    OVER w AS urutan
  FROM (
    SELECT p.id, p.wa_group_id, p.created_at,
           (SELECT count(*) FROM wa_messages m WHERE m.package_id = p.id) AS pesan,
           (SELECT count(*) FROM locations  l WHERE l.package_id = p.id AND l.is_active) AS lokasi
    FROM packages p
    WHERE p.wa_group_id IS NOT NULL
  ) s
  WINDOW w AS (PARTITION BY wa_group_id ORDER BY pesan DESC, lokasi DESC, created_at ASC)
) kalah
WHERE kalah.urutan > 1;

-- 3. Baru lepaskan tautan pada yang KALAH — dengan urutan pemenang yang sama
--    persis, jadi hasilnya identik dengan yang barusan dicatat.
UPDATE packages SET wa_group_id = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT p.id,
           row_number() OVER (
             PARTITION BY p.wa_group_id
             ORDER BY (SELECT count(*) FROM wa_messages m WHERE m.package_id = p.id) DESC,
                      (SELECT count(*) FROM locations  l WHERE l.package_id = p.id AND l.is_active) DESC,
                      p.created_at ASC
           ) AS urutan
    FROM packages p
    WHERE p.wa_group_id IS NOT NULL
  ) t
  WHERE t.urutan > 1
);

-- 4. Suarakan di log deploy. Perubahan diam-diam pada data produksi adalah
--    perubahan yang baru ketahuan saat sudah jadi kebiasaan.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM audit_logs
   WHERE action = 'package.wa_group_auto_unlink'
     AND created_at > now() - interval '1 minute';
  IF n > 0 THEN
    RAISE NOTICE 'MARLIN: % tautan grup WhatsApp ganda dilepas otomatis. Rinciannya di audit (action=package.wa_group_auto_unlink), termasuk nilai lama untuk dipulihkan.', n;
  END IF;
END $$;

-- 5. Indeks unik. TIDAK parsial, dan tidak perlu: PostgreSQL menganggap setiap
--    NULL berbeda, jadi paket tanpa grup tetap boleh banyak. Bentuk non-parsial
--    ini juga persis yang dihasilkan `@unique` Prisma, sehingga skema dan basis
--    data tidak berselisih saat drift diperiksa.
CREATE UNIQUE INDEX IF NOT EXISTS "packages_wa_group_id_key" ON "packages"("wa_group_id");
