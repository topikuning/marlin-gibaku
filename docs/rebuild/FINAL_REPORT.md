# LAPORAN AKHIR — REBUILD TOTAL MARLIN (2026-07-14)

## 1. Audit

- **Masalah lama** (rincian `CURRENT_STATE_AUDIT.md`): 4 taksonomi lifecycle paralel; laporan harian terpecah 2 model data + 4 menu; keuangan snapshot manual tak terekonsiliasi (3 model uang); permission `canManageUsers` jadi gate keuangan/kontrak/RAB; lock anti-dobel hanya app-level; `reportDate` di-stamp tanggal approve; 8 kolom FK menggantung; 0 test; tanpa CI; Nixpacks tanpa Dockerfile; next-auth & Tailwind beta di production; audit log tidak pernah ditulis; session JWT tak bisa direvoke.
- **Dipakai ulang (diverifikasi)**: parser HPS, formula kurva-S (smoothstep + per-trade, paritas Python), formula bobot/prestasi KKP, valueDone/lineage carry-over, semantik PPN (RAB pra-PPN vs kontrak inkl-PPN, toleransi 0.1%), template alur administrasi KKP 45 item, data seed 7 lokasi riil, pola halaman cetak A4, galeri foto + pipeline stamp.
- **Ditulis ulang**: seluruh app shell/IA, seluruh workspace (paket/lokasi/harian/keuangan/dokumen), auth & authorization, schema & seed, laporan periodik, deployment.
- **Dihapus**: model Prospek/ProspekLokasi, Device, OtpCode, SyncQueue, ScheduledMilestone, WeeklyReport, MonthlyReport, DailyLog*, CostEntry, DeviationNote, kolom keuangan snapshot; route /dashboard, /kontrak, /paket/prospek/*, split lapor/laporan/harian; migration dev lama; docs basi (RAILWAY, DEPLOY_RAILWAY, FEATURE_CHECKLIST).

## 2. Teknologi

Lama → target (semua pinned exact; `TECHNOLOGY_AUDIT.md`): Next 15.1→**16.2.10**, React 19.0→**19.2.7**, Prisma 6→**7.8.0**(+adapter-pg, WASM compiler), Tailwind 4-beta→**4.3.2 stable**, Zod 3→**4.4.3**, TS 5.7→**5.9.3** (TS7 ditahan, didokumentasikan), Node >=22→**24 LTS** (nvmrc/engines/Docker konsisten), pnpm 9→**11.13** via Corepack, ESLint 9.17→**9.39.5** (ESLint 10 ditahan — plugin Next belum kompatibel), Vitest 2→**4.1.10**, Playwright 1.49→**1.61.1**, **AG Grid Community 36** (baru; tanpa Enterprise). Dihapus: next-auth beta, @tanstack/react-table+query, @react-pdf/renderer, recharts, leaflet, react-hook-form. Lisensi: semua allowlist open-source; audit otomatis di CI + pengecualian terdokumentasi (`OPEN_SOURCE_LICENSE_AUDIT.md`). `pnpm audit`: 0 high/critical (3 moderate transitive dev).

## 3. Arsitektur

- **Lifecycle**: `PackageStage` (prospek→…→selesai|batal, histori append-only) + `LocationStatus` fisik (persiapan→…→FHO) + workflow `DailyReport` (draft→dikirim→perlu_koreksi→disetujui→final) + `AdminMilestone` (6 status + terlambat derived). Mesin transisi tunggal `src/lib/lifecycle.ts`.
- **Navigasi task-based**: Beranda (Command Center exception-first) · Paket (workspace 6 tab) · Lokasi (workspace 7 tab) · Hari Ini (mobile lapangan) · Progress · Keuangan · Dokumen · Laporan · Pengguna · Sistem. Bottom-nav mobile ≤4 tujuan per role.
- **Alur role**: mandor: Hari Ini → lapor volume+foto → kirim. SM: verifikasi + lengkapi KKP + final + cetak dalam SATU layar tanggal. PM/AM: review, approve keuangan. Direksi: Command Center + workspace.

## 4. Database

- Schema baru 36 model (`prisma/schema.prisma`): FK nyata semua relasi, uniq constraint (lokasi+tanggal, report+lineage, packageId kontrak, contractNumber, termin, dsb.), trigger append-only 5 tabel histori/audit, index sesuai pola akses. RAB = `RabNode` satu tabel + `lineageKey` path stabil. Keuangan = 7 model transaksi. Uang BigInt; volume Decimal(15,3); Timestamptz + @db.Date utk tanggal kerja.
- Migration: baseline baru `20260714005112_init` + `..._append_only_triggers` (dev lama dihapus — pra-production).
- Seed deterministik-idempotent: 8 user (semua role; 1 wajib-ganti-password), 3+2 vendor, 9 paket (6 berkontrak — 1 multi-lokasi, prospek, tender, batal), 7 lokasi riil ~14k RabNode, baseline auto per-trade, laporan harian 5 status + tenaga/material/alat + histori, kendala+pemulihan, budget/PO/expense/invoice+pembayaran parsial/kasbon/billing+pencairan, 45×7 milestone, setting PPN. Angka diturunkan dari satu basis Σ leaf (total kategori JSON lama korup — dicatat OPEN_ISSUES).

## 5. UI/UX

Design tokens Tailwind 4 (navy #1E3A8A, tanpa hex tersebar), Inter di-vendor lokal, tabular numerals, komponen ui/ (13 primitives) + `MarlinGrid` (AG Grid Community: sort/filter/quick search/pagination/infinite model/CSV/persist state/locale ID/overlay), shell fluid ≤1600px + sidebar + bottom-nav, form pola tunggal (Server Action + zod + useActionState + Banner), a11y (label/focus/aria/touch target), cetak A4 tanpa shell. Screenshot 21 halaman: `artifacts/rebuild/screenshots/`.

## 6. Deployment

Dockerfile multi-stage (node:24.18.0-bookworm-slim, corepack+pnpm frozen, standalone, non-root uid1001, tini, CA+OpenSSL, prisma CLI global utk migrate deploy), `.dockerignore`, `railway.json` builder DOCKERFILE + preDeploy `prisma migrate deploy` + healthcheck `/api/health` (R2 bukan hard-dep; diagnostik `/api/ready` + `/sistem`). Nixpacks dihapus. Verifikasi: build via CI (sandbox dev diblok gateway utk pull base image — dicatat jujur di `DOCKER_VERIFICATION.md`); runtime standalone (perintah persis CMD) lulus di host.

## 7. Testing

- Perintah: lihat README/TEST_PLAN. Hasil: **typecheck 0 error; lint 0 error; unit 51 pass** (parser/flatten/kurva-S/money/authz/env); **integration 10 pass** (constraint DB: anti-dobel, konversi idempotent, append-only; siklus laporan penuh termasuk guard volume & koreksi-tak-dobel & transisi ilegal ditolak); **E2E 16 pass** desktop+mobile (auth, first-login, logout, otorisasi per role, 404 utk capability kurang); **build production sukses**; visual QA 21 screenshot semua HTTP 200.
- CI GitHub Actions: install→license→security→typecheck→lint→unit→integration(Postgres service)→build→docker→e2e.
- Bug ditemukan & diperbaiki selama verifikasi: halaman capability bocor 500 → 404; tombol keluar mobile tanpa nama aksesibel; seed melanggar guard volume; race login E2E; modul client menarik import server (dipecah documents-meta); lint react-hooks purity (3).

## 8. Risiko & pekerjaan tersisa (jujur)

1. **Data seed kategori korup** dari parser python lama (roman ganda, kategori hilang) — angka konsisten via Σ leaf, tapi pembagian kategori menunggu HPS xlsx asli utk re-import (OPEN_ISSUES 🔴).
2. **Docker build belum terverifikasi di sandbox ini** (egress gateway menolak CDN registry) — diverifikasi via CI; jangan deploy sebelum job docker hijau.
3. **Ditunda sadar**: PWA offline penuh (sekarang draft lokal + submit idempoten); PR/PO/receiving granular; intake WA; cash-forecast UI (formula sudah ada).
4. RLS belum ada (authorization application-layer, teruji); rate limit baru di login; CSP headers belum.
5. E2E belum menutup semua alur §36 (prospek→kontrak, import RAB, keuangan via UI — logika terverifikasi di integration/manual; E2E UI lanjutan = pekerjaan berikut).
6. exceljs maintenance lambat (alternatif dievaluasi bila jadi masalah).
