-- SINKRON KAWAL KNMP tahap 2 (DECISIONS 689, 690).
--
-- Data Kawal = RUJUKAN, bukan angka resmi: tabel-tabel ini tidak dibaca
-- calculation layer. Snapshot APPEND-ONLY (trigger di bawah) – tarikan yang
-- isinya sama tidak membuat snapshot baru, hanya baris `kawal_sync_runs`.
--
-- Idempoten (DECISIONS 167): aman dijalankan ulang bila deploy terputus.

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_snapshots" (
    "id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_count" INTEGER NOT NULL,
    "stored_count" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,

    CONSTRAINT "kawal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_location_snapshots" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "kawal_id" INTEGER NOT NULL,
    "nama_knmp" TEXT NOT NULL,
    "desa" TEXT,
    "kecamatan" TEXT,
    "kabupaten" TEXT NOT NULL,
    "provinsi" TEXT,
    "tahap" INTEGER,
    "kategori" INTEGER,
    "penyedia" TEXT,
    "no_kontrak" TEXT,
    "tgl_kontrak" DATE,
    "no_spmk" TEXT,
    "mulai" DATE,
    "selesai" DATE,
    "estimasi_hari" INTEGER,
    "nilai_kontrak" BIGINT,
    "nilai_lokasi" BIGINT,
    "nilai_add1" BIGINT,
    "nilai_add2" BIGINT,
    "nilai_add3" BIGINT,
    "status_kontrak" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "actual_pct" DECIMAL(9,4),
    "pelaksana_pct" DECIMAL(9,4),
    "target_pct" DECIMAL(9,4),
    "deviasi_pct" DECIMAL(9,4),
    "realisasi_pengawas_pct" DECIMAL(9,4),
    "realisasi_pelaksana_pct" DECIMAL(9,4),
    "week_no" INTEGER,
    "max_weeks" INTEGER,
    "last_actual_week" INTEGER,
    "last_pelaksana_week" INTEGER,
    "kurva" JSONB NOT NULL,
    "remark_kondisi_umum" TEXT,
    "remark_hambatan" TEXT,
    "remark_saran_instruksi" TEXT,

    CONSTRAINT "kawal_location_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_sarana_snapshots" (
    "id" UUID NOT NULL,
    "location_snapshot_id" UUID NOT NULL,
    "kawal_item_id" INTEGER NOT NULL,
    "sarpras_id" INTEGER,
    "nama" TEXT NOT NULL,
    "jenis" TEXT,
    "nilai" BIGINT,
    "status" INTEGER,
    "bobot" DECIMAL(9,4),
    "progres_pct" DECIMAL(9,4),
    "realisasi_kumulatif" DECIMAL(9,4),

    CONSTRAINT "kawal_sarana_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_location_maps" (
    "id" UUID NOT NULL,
    "kawal_id" INTEGER NOT NULL,
    "location_id" UUID,
    "status" TEXT NOT NULL,
    "basis" TEXT,
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kawal_location_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "kawal_sync_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "outcome" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "by_id" UUID,
    "row_count" INTEGER,
    "matched_count" INTEGER,
    "queue_count" INTEGER,
    "discarded_count" INTEGER,
    "snapshot_id" UUID,
    "error" TEXT,

    CONSTRAINT "kawal_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kawal_snapshots_captured_at_idx" ON "kawal_snapshots"("captured_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kawal_location_snapshots_kawal_id_idx" ON "kawal_location_snapshots"("kawal_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "kawal_location_snapshots_snapshot_id_kawal_id_key" ON "kawal_location_snapshots"("snapshot_id", "kawal_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kawal_sarana_snapshots_location_snapshot_id_idx" ON "kawal_sarana_snapshots"("location_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "kawal_location_maps_kawal_id_key" ON "kawal_location_maps"("kawal_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "kawal_location_maps_location_id_key" ON "kawal_location_maps"("location_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "kawal_sync_runs_started_at_idx" ON "kawal_sync_runs"("started_at");

-- AddForeignKey
ALTER TABLE "kawal_location_snapshots" DROP CONSTRAINT IF EXISTS "kawal_location_snapshots_snapshot_id_fkey";
ALTER TABLE "kawal_location_snapshots" ADD CONSTRAINT "kawal_location_snapshots_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "kawal_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kawal_sarana_snapshots" DROP CONSTRAINT IF EXISTS "kawal_sarana_snapshots_location_snapshot_id_fkey";
ALTER TABLE "kawal_sarana_snapshots" ADD CONSTRAINT "kawal_sarana_snapshots_location_snapshot_id_fkey" FOREIGN KEY ("location_snapshot_id") REFERENCES "kawal_location_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kawal_location_maps" DROP CONSTRAINT IF EXISTS "kawal_location_maps_location_id_fkey";
ALTER TABLE "kawal_location_maps" ADD CONSTRAINT "kawal_location_maps_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Pasangan: `bukan_marlin` satu-satunya status tanpa lokasi.
ALTER TABLE "kawal_location_maps" DROP CONSTRAINT IF EXISTS "kawal_location_maps_status_check";
ALTER TABLE "kawal_location_maps" ADD CONSTRAINT "kawal_location_maps_status_check"
  CHECK ("status" IN ('otomatis', 'dikonfirmasi', 'bukan_marlin'));
ALTER TABLE "kawal_location_maps" DROP CONSTRAINT IF EXISTS "kawal_location_maps_lokasi_check";
ALTER TABLE "kawal_location_maps" ADD CONSTRAINT "kawal_location_maps_lokasi_check"
  CHECK (("status" = 'bukan_marlin') = ("location_id" IS NULL));

ALTER TABLE "kawal_sync_runs" DROP CONSTRAINT IF EXISTS "kawal_sync_runs_outcome_check";
ALTER TABLE "kawal_sync_runs" ADD CONSTRAINT "kawal_sync_runs_outcome_check"
  CHECK ("outcome" IN ('berjalan', 'berhasil', 'tidak_berubah', 'gagal'));
ALTER TABLE "kawal_sync_runs" DROP CONSTRAINT IF EXISTS "kawal_sync_runs_trigger_check";
ALTER TABLE "kawal_sync_runs" ADD CONSTRAINT "kawal_sync_runs_trigger_check"
  CHECK ("trigger" IN ('cron', 'manual'));

-- Snapshot = catatan apa yang dikirim Kawal pada waktu itu. Tidak dikoreksi.
DROP TRIGGER IF EXISTS kawal_snapshots_append_only ON "kawal_snapshots";
CREATE TRIGGER kawal_snapshots_append_only
  BEFORE UPDATE OR DELETE ON "kawal_snapshots"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

DROP TRIGGER IF EXISTS kawal_location_snapshots_append_only ON "kawal_location_snapshots";
CREATE TRIGGER kawal_location_snapshots_append_only
  BEFORE UPDATE OR DELETE ON "kawal_location_snapshots"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();

DROP TRIGGER IF EXISTS kawal_sarana_snapshots_append_only ON "kawal_sarana_snapshots";
CREATE TRIGGER kawal_sarana_snapshots_append_only
  BEFORE UPDATE OR DELETE ON "kawal_sarana_snapshots"
  FOR EACH ROW EXECUTE FUNCTION marlin_forbid_mutation();
