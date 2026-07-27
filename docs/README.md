# Peta Dokumentasi MARLIN

Mulai dari mana tergantung yang Anda cari.

## Kalau Anda mau MEMBANGUN

| Butuh | Baca |
|---|---|
| Aturan kerja & perintah harian | [`../CLAUDE.md`](../CLAUDE.md) |
| Arsitektur, domain model, **formula angka kanonik** | [`../PROJECT.md`](../PROJECT.md) — *single source of truth* |
| Apa yang masih rusak / belum selesai | [`OPEN_ISSUES.md`](./OPEN_ISSUES.md) |
| Kenapa sesuatu diputuskan begitu | [`DECISIONS.md`](./DECISIONS.md) — append-only |
| Menyentuh progress / laporan / kurva-S / uang | [`rebuild/CALCULATION_INTEGRITY_PROTOCOL.md`](./rebuild/CALCULATION_INTEGRITY_PROTOCOL.md) — **wajib** |

## Kalau Anda mau MENJALANKAN / DEPLOY

| Butuh | Baca |
|---|---|
| Jalankan lokal, stack, perintah | [`../README.md`](../README.md) |
| Deploy Railway langkah demi langkah | [`DEPLOY_RAILWAY.md`](./DEPLOY_RAILWAY.md) |
| Sambungkan WhatsApp (WAHA) | [`WAHA_SETUP.md`](./WAHA_SETUP.md) |
| Sambungkan Google Drive KKP | [`GDRIVE_SETUP.md`](./GDRIVE_SETUP.md) |
| Kebijakan dependency & lisensi | [`DEPENDENCY_POLICY.md`](./DEPENDENCY_POLICY.md) |

## Referensi yang HIDUP (diperbarui mengikuti kode)

| Dokumen | Isi |
|---|---|
| [`rebuild/PERMISSION_MATRIX.md`](./rebuild/PERMISSION_MATRIX.md) | Role × capability. **Dibangkitkan** dari `src/lib/authz.ts` (`pnpm docs:permission`), dijaga `tests/unit/permission-matrix-doc.test.ts` |
| [`rebuild/DOMAIN_MODEL.md`](./rebuild/DOMAIN_MODEL.md) | Entitas & relasi target |
| [`rebuild/TECHNOLOGY_AUDIT.md`](./rebuild/TECHNOLOGY_AUDIT.md) | Versi tiap dependency + alasan pin |
| [`rebuild/TEST_PLAN.md`](./rebuild/TEST_PLAN.md) | Strategi & cakupan pengujian |
| [`rebuild/CALCULATION_INTEGRITY_PROTOCOL.md`](./rebuild/CALCULATION_INTEGRITY_PROTOCOL.md) | Gate wajib untuk pekerjaan yang menyentuh angka |
| [`FORECAST_DESIGN.md`](./FORECAST_DESIGN.md) | Desain proyeksi penyelesaian |

## ARSIP — snapshot rebuild 2026-07-14, bukan spesifikasi berjalan

Dokumen ini merekam kondisi sistem **lama** (commit `b6e77af`) dan proses
rebuild. Berguna untuk memahami *kenapa* sesuatu dibuang, tetapi **jangan
dipakai sebagai acuan implementasi** — masing-masing sudah diberi banner ARSIP.

`CURRENT_STATE_AUDIT` · `DATA_MODEL_AUDIT` · `SCREEN_AND_ROUTE_INVENTORY` ·
`BUSINESS_LIFECYCLE` · `TARGET_INFORMATION_ARCHITECTURE` · `REBUILD_PLAN` ·
`TRACEABILITY_MATRIX` · `FINAL_REPORT` · `DOCKER_VERIFICATION` ·
`DEPLOYMENT_ARCHITECTURE` · `OPEN_SOURCE_LICENSE_AUDIT`

## Aturan merawat dokumentasi

1. **`PROJECT.md` menang.** Kalau kode dan `PROJECT.md` berbeda, kodenya yang
   salah — atau `PROJECT.md` yang lupa diperbarui. Jangan biarkan menggantung.
2. **Keputusan baru → append `DECISIONS.md`.** Jangan pernah menyunting entri
   lama; kalau berubah, tulis entri baru yang menyebut nomor lamanya.
3. **Masalah baru → `OPEN_ISSUES.md`.** Yang sudah selesai DIHAPUS dari sana,
   bukan dicoret — riwayatnya sudah aman di `DECISIONS.md` dan git.
4. **Dokumen yang bisa dibangkitkan, bangkitkan.** Matriks permission sudah;
   tambahkan penjaga uji bila membuat dokumen turunan lain.
5. **Arsip diberi banner, tidak dihapus.** Menghapus jejak alasan lebih mahal
   daripada menyimpan file yang jelas-jelas bertanda ARSIP.
