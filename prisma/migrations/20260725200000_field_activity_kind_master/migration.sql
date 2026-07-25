-- Master data jenis kegiatan lapangan (menggantikan enum FieldActivityType).

-- 1) Tabel master
CREATE TABLE "field_activity_kinds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "field_activity_kinds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "field_activity_kinds_key_key" ON "field_activity_kinds"("key");

-- 2) Seed jenis (6 lama + Survei Awal). Idempoten via ON CONFLICT.
INSERT INTO "field_activity_kinds" ("key", "label", "sort_order", "is_active") VALUES
    ('survei_awal', 'Survei Awal', 5, true),
    ('rapat_pcm', 'Rapat Persiapan (PCM)', 10, true),
    ('pengukuran_uitzet', 'Pengukuran / Uitzet', 20, true),
    ('mc0', 'Mutual Check awal (MC-0)', 30, true),
    ('dokumentasi_0', 'Dokumentasi kondisi 0%', 40, true),
    ('sosialisasi', 'Sosialisasi', 50, true),
    ('mobilisasi', 'Mobilisasi', 60, true),
    ('lainnya', 'Lainnya', 999, true)
ON CONFLICT ("key") DO NOTHING;

-- 3) Kolom type: enum FieldActivityType → TEXT (nilai enum sudah berupa string yang sama).
ALTER TABLE "field_activities" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

-- 4) Buang enum yang tak terpakai.
DROP TYPE "FieldActivityType";
