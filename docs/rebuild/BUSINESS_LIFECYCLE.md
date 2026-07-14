# BUSINESS LIFECYCLE — MARLIN

Alur bisnis KNMP (83 lokasi, 7 provinsi; owner = KKP; PT sebagai pengendali program dengan vendor pelaksana).

```
Portfolio
→ Prospek/Tender     Package stage: prospek → tender (undangan, aanwijzing, penawaran, negosiasi) → penetapan (SPPBJ)
→ Kontrak            konversi idempotent: Contract + aktivasi Location + dokumen kontrak/jaminan
→ Mulai Kerja        SPMK, serah terima lapangan, PCM, MC-0 (AdminMilestone fase mulai_kerja)
→ Pelaksanaan        RAB aktif + Baseline → WeeklyPlan → DailyReport (volume, tenaga, material, alat, cuaca, foto, kendala)
                     → verifikasi → progress (bobot/prestasi, kurva-S) → Issue/Recovery bila deviasi
→ Administrasi       milestone per fase + Document Center (bukti); keuangan transaksi berjalan paralel
→ Penagihan          OwnerBilling (termin/MC) → Disbursement; vendor: Commitment → Invoice → PaymentOut
→ PHO                BAST-1, retensi mulai
→ Pemeliharaan       masa pemeliharaan, defect list = Issue
→ FHO                BAST-2, retensi lepas
→ Penutupan          Package selesai; arsip lengkap
```

## Status canonical

- **PackageStage** (disimpan + histori, transisi eksplisit): `prospek → tender → penetapan → kontrak → pelaksanaan → serah_terima → selesai`; terminal alternatif `batal` (dengan alasan). Trigger transisi = aksi user (mis. konversi) — dokumen menjadi *bukti* dan bisa *menyarankan* transisi, tidak pernah otomatis memindahkan stage tanpa aksi.
- **LocationStatus** (fisik): `persiapan → berjalan ⇄ terhenti → selesai → pho → pemeliharaan → fho`; terminal `batal`. Histori append-only.
- **DailyReport**: `draft → dikirim → (perlu_koreksi → dikirim)* → disetujui → final`. Rejected item = report dikembalikan `perlu_koreksi` dengan alasan; angka hanya dihitung dari status ≥ `dikirim` dan tidak dobel saat revisi (item diedit pada report yang sama, bukan duplikat).
- **AdminMilestone**: `belum_dimulai / berjalan / menunggu_pihak_lain / perlu_perbaikan / selesai / tidak_berlaku` (+`terlambat` = derived dari dueDate). Milestone `requiresVerification` tidak bisa selesai hanya karena dokumen di-upload.
- **Transaksi keuangan**: `draft/diajukan → disetujui|ditolak → (dibayar_sebagian → lunas)`.

## PIC per fase

- Prospek/tender/kontrak: program_director (+admin).
- Pelaksanaan harian: field_supervisor (input) → site_manager (verifikasi+lengkapi+final) → project_manager (review).
- Keuangan: input SM/PM → approve RM/direksi.
- Serah terima: PM + direksi.
