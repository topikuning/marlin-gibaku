-- KATALOG HARGA WILAYAH (DECISIONS 806)
ALTER TABLE "hsd_usulan_ai" ADD COLUMN "metode" TEXT;
ALTER TABLE "hsd_usulan_ai" ADD COLUMN "sumber" JSONB;

CREATE TABLE "harga_wilayah" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provinsi" TEXT NOT NULL,
    "kabupaten" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "harga" BIGINT NOT NULL,
    "harga_min" BIGINT,
    "harga_maks" BIGINT,
    "metode" TEXT NOT NULL,
    "keyakinan" TEXT NOT NULL,
    "alasan" TEXT NOT NULL,
    "sumber" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "diperbarui_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harga_wilayah_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "harga_wilayah_org_id_provinsi_kabupaten_kategori_nama_satua_key" ON "harga_wilayah"("org_id", "provinsi", "kabupaten", "kategori", "nama", "satuan");
CREATE INDEX "harga_wilayah_org_id_provinsi_kabupaten_idx" ON "harga_wilayah"("org_id", "provinsi", "kabupaten");

ALTER TABLE "harga_wilayah" ADD CONSTRAINT "harga_wilayah_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
