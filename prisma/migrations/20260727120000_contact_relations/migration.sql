-- Manajemen Kontak terpadu (DECISIONS 150).
--
-- WaContact & WaSenderAlias sebelumnya menyimpan owner_id / org_id / created_by_id
-- sebagai UUID lepas tanpa foreign key. Akibatnya kontak tidak bisa disaring per
-- organisasi (buildSenderDirectory membaca SEMUA kontak lintas tenant) dan
-- baris yatim tidak pernah ikut terhapus saat user dihapus.

-- 1. updated_at pada wa_contacts. DEFAULT now() supaya baris lama terisi.
ALTER TABLE "wa_contacts"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Bersihkan baris yatim sebelum foreign key dipasang.
--    Kontak tanpa pemilik tidak bisa dikelola siapa pun — buang.
DELETE FROM "wa_contacts" c
  WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."owner_id");
--    Alias tanpa organisasi tidak pernah terbaca — buang.
DELETE FROM "wa_sender_aliases" a
  WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = a."org_id");
--    Pembuat alias yang sudah dihapus: aliasnya TETAP dipakai (milik organisasi),
--    cukup lepas jejak pembuatnya.
UPDATE "wa_sender_aliases" a SET "created_by_id" = NULL
  WHERE a."created_by_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."created_by_id");

-- 3. Foreign key.
ALTER TABLE "wa_contacts" ADD CONSTRAINT "wa_contacts_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_sender_aliases" ADD CONSTRAINT "wa_sender_aliases_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wa_sender_aliases" ADD CONSTRAINT "wa_sender_aliases_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Indeks bantu untuk halaman Manajemen Kontak (urut nama, filter org).
CREATE INDEX IF NOT EXISTS "wa_sender_aliases_org_id_idx" ON "wa_sender_aliases"("org_id");

-- Default hanya untuk mengisi baris lama; selanjutnya Prisma (@updatedAt) yang
-- selalu mengirim nilainya. Dilepas agar skema & DB tidak drift.
ALTER TABLE "wa_contacts" ALTER COLUMN "updated_at" DROP DEFAULT;
