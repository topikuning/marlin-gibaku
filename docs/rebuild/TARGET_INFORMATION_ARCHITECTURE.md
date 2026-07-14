# TARGET INFORMATION ARCHITECTURE — MARLIN Rebuild

Menu berdasarkan pekerjaan, bukan tabel database. Maksimal 2 tingkat. Menu difilter per capability.

## Desktop (sidebar)

```
MARLIN
├─ Beranda            /                    Command Center (exception-first, per role)
├─ Paket & Proyek
│  ├─ Paket           /paket               daftar paket (prospek→selesai), AG Grid
│  │  └─ Workspace    /paket/[id]          tab: Ringkasan · Tender & Administrasi · Kontrak & Adendum · Lokasi · Keuangan · Dokumen · Aktivitas
│  └─ Lokasi          /lokasi              daftar lokasi, AG Grid
│     └─ Workspace    /lokasi/[slug]       tab: Ringkasan · Rencana & RAB · Pelaksanaan Harian · Progress · Keuangan · Dokumen & Kepatuhan · Laporan · Tim & Aktivitas
├─ Pelaksanaan
│  └─ Hari Ini        /hari-ini            landing lapangan (SM/mandor) — mobile-first
├─ Progress           /progress            portfolio plan vs aktual, deviasi, kurva-S
├─ Keuangan           /keuangan            KPI + transaksi + approval queue
├─ Administrasi
│  └─ Dokumen         /dokumen             Document Center lintas entitas
├─ Laporan            /laporan             pusat laporan (harian/mingguan/bulanan/KKP/export)
├─ Organisasi
│  └─ Pengguna        /pengguna            user + penugasan
└─ Sistem             /sistem              diagnostik R2, audit log, setting, reset dev
```

Cetak (tanpa shell): `/cetak/harian/[slug]/[date]`, `/cetak/periodik/[slug]/[kind]/[n]`.
Auth: `/masuk`, `/ganti-password` (paksa saat mustChangePassword).

## Mobile (bottom nav, max 5, per role)

- **SM / Mandor**: Hari Ini · Lapor · Proyek · Tugas · Lainnya
- **PM / RM**: Beranda · Proyek · Progress · Persetujuan · Lainnya
- **Direksi / Exec**: Beranda · Paket · Progress · Laporan · Lainnya

## Command Center (Beranda)

Exception-first: "Perlu Tindakan" (laporan menunggu verifikasi, milestone terlambat, invoice due, proyek deviasi kritis) di atas; KPI ringkas bisa diklik → membuka data pembentuk; filter global (provinsi, paket, status, periode). Tanpa chart dekoratif.

## Yang dihapus dari IA lama

- `/dashboard` (redirect mati), `/kontrak` (masuk workspace paket), `/paket/prospek/*` (prospek = paket stage awal, satu workspace), `/lokasi/[slug]/lapor` + `/laporan` split (disatukan: input & verifikasi dalam satu workspace harian per tanggal), `/diagnostik` (→ `/sistem`), `/peta` (defer — dicatat REBUILD_PLAN).
- Menu horizontal scroll mobile lama → bottom nav 5 tujuan.
- `max-w-7xl` global → halaman data pakai fluid hingga ~1600px.
