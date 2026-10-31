-- Berkas termin tingkat paket (Kurva S, surat, dokumen kontrak) diantre tanpa
-- lokasi (DECISIONS 721). DROP NOT NULL idempoten: aman dijalankan ulang.
ALTER TABLE "gdrive_jobs" ALTER COLUMN "location_id" DROP NOT NULL;
