-- CCO LAHIR SAAT AKTIVASI, BUKAN SEBELUMNYA (DECISIONS 613)
--
-- Perubahan lingkup lokasi (tambah/cabut) kini boleh berupa DRAFT tanpa nomor
-- CCO dan tanpa tanggal berlaku: keduanya baru diisi saat adendum diaktifkan
-- di tingkat paket, dari dokumen yang sudah ditandatangani. Baris lama tetap
-- utuh — kolomnya hanya dilonggarkan, tidak ada nilai yang diubah.
--
-- `value_delta_rab` = perubahan nilai kontrak MENURUT RAB (turunan, dibekukan
-- saat aktivasi). `value_delta` tetap angka RESMI di dokumen CCO — bawaannya
-- sama dengan turunan RAB, boleh diketik bila berbeda karena pembulatan.
-- CCO lama tidak punya pembanding RAB, jadi kolomnya NULL.
--
-- Idempoten (DECISIONS 167).

ALTER TABLE "location_scope_changes" ALTER COLUMN "amendment_id" DROP NOT NULL;
ALTER TABLE "location_scope_changes" ALTER COLUMN "effective_date" DROP NOT NULL;
ALTER TABLE "contract_amendments" ADD COLUMN IF NOT EXISTS "value_delta_rab" BIGINT;
