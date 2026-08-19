-- SATU GRUP WHATSAPP HANYA BOLEH MILIK SATU PAKET (DECISIONS 370).
--
-- Sebelum ini `packages.wa_group_id` tanpa batasan apa pun, sementara
-- pembacaannya memakai `findFirst()` atas beberapa varian tulisan. Dua paket
-- yang menunjuk grup sama membuat paket mana yang menjawab ditentukan urutan
-- baris — dan itu berarti data paket A bisa terkirim ke grup paket B.
--
-- Tiga langkah, dan urutannya penting: kanonikkan dulu, TOLAK duplikat dengan
-- menyebut kandidatnya, baru pasang indeks. Memasang indeks lebih dulu hanya
-- menghasilkan galat unique-constraint yang tidak menyebut paket mana.

-- 1. Kanonikkan bentuk yang tersimpan.
--
--    Cerminan `kanonikGrupId()` di src/lib/waha/grup-id.ts untuk bentuk yang
--    BISA tersimpan lewat jalur aplikasi lama (`normalizeGroupChatId` hanya
--    meloloskan yang berakhiran @g.us / @c.us, atau angka-dan-strip):
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

-- 2. Duplikat DITOLAK, dan paketnya disebut namanya.
--
--    Migrasi yang gagal tanpa menyebut apa pun memaksa orang menebak; yang
--    memilih diam-diam salah satu justru menyembunyikan masalah isolasi data.
DO $$
DECLARE
  daftar text;
BEGIN
  SELECT string_agg(baris, E'\n') INTO daftar
  FROM (
    SELECT wa_group_id || ' dipakai ' || count(*) || ' paket: '
             || string_agg(name, ', ' ORDER BY created_at) AS baris
    FROM packages
    WHERE wa_group_id IS NOT NULL
    GROUP BY wa_group_id
    HAVING count(*) > 1
  ) d;

  IF daftar IS NOT NULL THEN
    RAISE EXCEPTION E'Satu grup WhatsApp tertaut ke lebih dari satu paket. Lepaskan dulu tautan yang salah di Paket → Grup WhatsApp, lalu jalankan migrasi ini lagi.\n%', daftar;
  END IF;
END $$;

-- 3. Indeks unik. TIDAK parsial, dan tidak perlu: PostgreSQL menganggap setiap
--    NULL berbeda dari NULL lain, jadi paket tanpa grup tetap boleh banyak.
--    Bentuk non-parsial ini juga persis yang dihasilkan `@unique` Prisma,
--    sehingga skema dan basis data tidak berselisih saat drift diperiksa.
CREATE UNIQUE INDEX IF NOT EXISTS "packages_wa_group_id_key" ON "packages"("wa_group_id");
