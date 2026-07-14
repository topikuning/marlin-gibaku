# SCREEN & ROUTE INVENTORY — aplikasi lama (per b6e77af)

Verdict per modul di `CURRENT_STATE_AUDIT.md`. IA target di `TARGET_INFORMATION_ARCHITECTURE.md`.

## Route lama

| Route | Fungsi | Akses | Nasib di rebuild |
|---|---|---|---|
| `/` | redirect beranda/masuk | any | tetap (→ Command Center) |
| `/masuk` | login | publik | tulis ulang (auth baru) |
| `/beranda` | dashboard ATAU home reporter | login | → `/` Command Center exception-first |
| `/dashboard` | redirect legacy | — | **hapus** |
| `/peta` (+`/api/peta/[id]`) | peta Leaflet | login, scoped | **defer** |
| `/paket` | funnel + prospek cards + kontrak | dashboard roles | tulis ulang (AG Grid + workspace) |
| `/paket/[id]` | detail kontrak + adendum + flow admin | dashboard; edit prospek.manage | → workspace paket ber-tab |
| `/paket/prospek/baru`, `/paket/prospek/[id]` | CRUD prospek + konversi | prospect.manage | digabung ke workspace paket |
| `/kontrak` | master kontraktor+kontrak (TANPA entri nav!) | canManageUsers (salah gate) | digabung ke workspace paket |
| `/lokasi` | daftar lokasi | login, scoped | tetap (AG Grid) |
| `/lokasi/[slug]` | ringkasan + kurva-S + deviasi | scoped | workspace 8 tab baru |
| `/lokasi/[slug]/rab` (+`/rab/import`) | pohon RAB + import | view all / canManageUsers | tab Rencana & RAB; gate rab.manage |
| `/lokasi/[slug]/kurva-s` | edit baseline | canManageUsers | tab Rencana & RAB; gate baseline.manage |
| `/lokasi/[slug]/lapor` | input volume+foto (mobile-ok) | canReport | disatukan → workspace harian + `/hari-ini` |
| `/lokasi/[slug]/harian/[date]` | editor KKP enrichment | canApprove edit | disatukan → workspace harian |
| `/lokasi/[slug]/periodik` | laporan mingguan/bulanan | login | tab Laporan |
| `/lokasi/[slug]/dokumen`, `/administrasi` | arsip + checklist 40 item | scoped | tab Dokumen & Kepatuhan (milestone workflow) |
| `/laporan`, `/laporan/[id]` | antrean approve + launcher + detail | canReport/canApprove | verifikasi masuk workspace harian; antrean → Command Center |
| `/keuangan` | KPI + grid edit snapshot | dashboard; edit canManageUsers | tulis ulang transaction-based |
| `/pengguna` | user CRUD | canManageUsers | refactor (user.manage) |
| `/diagnostik` | R2 self-test + reset TRUNCATE | canManageUsers/super_admin | → `/sistem` (guard APP_ENV) |
| `/cetak/harian/...`, `/cetak/periodik/...` | print A4 KKP | login | pola dipertahankan |
| `/api/health` | cek DB | publik | tetap + dipakai Railway healthcheck |
| `/api/documents/[id]` | presigned download | login+scoped | tetap (authz baru) |
| `/api/auth/[...nextauth]` | next-auth | — | **hapus** (auth custom) |

## Komponen lama

| Komponen | Verdict |
|---|---|
| `data-grid.tsx` (TanStack) | ganti AG Grid wrapper |
| `photo-gallery.tsx` | pakai ulang |
| `scurve-chart.tsx` | pakai ulang (satu-satunya renderer; hapus duplikat di kkp-period) |
| `kkp-daily-report.tsx` | refactor (hapus HOURS hardcode berlebih, signer data) |
| `kkp-period-report.tsx` | tulis ulang (monolit 350 baris + S-curve duplikat) |
| `page-header`, `lokasi-tabs`, `side-nav`, `app-nav` | tulis ulang dalam shell baru |
| `auto-print.tsx` (2 salinan identik) | satu salinan |
| Kpi/Stat/Alert inline (±7 duplikat antar halaman) | ekstrak ke `components/ui` |

## Masalah UX lama (ditutup oleh IA baru)

- Laporan harian tersebar 4 tempat (lapor / laporan / harian / cetak) dengan 3 label mirip.
- `/kontrak` tidak terjangkau dari nav.
- Blok scoping lokasi copy-paste ±7 halaman → helper `accessibleLocations()`.
- Threshold status deviasi berbeda-beda antar halaman (-1/-10 vs -5/0) → satu konstanta.
- Warna hex + `#1e3a8a` hardcoded puluhan file; `@theme` token tidak dipakai → design tokens wajib.
- `DEFAULT_ORG_ID` hardcode 4 file.
- PPN 11% hardcode 1 halaman.
- Header halaman tidak konsisten (PageHeader vs h1 manual).
- KKP table min-width 520–860px di mobile (print-oriented, dipertahankan hanya utk cetak).
