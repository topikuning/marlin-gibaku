# REBUILD PLAN — MARLIN

Eksekusi vertical slices; tiap slice usable + lulus typecheck/lint/test/build sebelum lanjut.

## Slice 1 — Foundation
- Upgrade stack (lihat TECHNOLOGY_AUDIT): Next 16, React 19.2, Prisma 7 + adapter-pg, Tailwind 4 stable, Zod 4, pnpm 11, Node 24, pin exact semua.
- Hapus: next-auth (beta), tanstack table/query, react-pdf, recharts, leaflet, react-hook-form.
- Schema Prisma baru (DOMAIN_MODEL) → hapus migration lama → baseline migration → reset dev DB → seed baru.
- Auth custom: session DB + argon2id + rate limit login + mustChangePassword + capability authz (PERMISSION_MATRIX).
- Design tokens (globals.css @theme; navy #1E3A8A, tanpa hex tersebar) + app shell (sidebar desktop, bottom-nav mobile, breadcrumb, action bar).
- AG Grid Community wrapper `MarlinGrid` (sort/filter/quick search/pagination/infinite model/CSV/persist state/URL sync/overlay).
- Dockerfile multi-stage + .dockerignore + railway.json (DOCKERFILE builder) + /api/health + /api/ready.
- CI GitHub Actions lengkap.
- Vitest + Playwright config + unit test formula.

## Slice 2 — Lifecycle paket
Package + stage history; workspace paket (tab sesuai lifecycle); konversi prospek→kontrak idempotent; adendum (nilai/waktu) → RabRevision/Baseline hook; vendor master; dokumen per tahap.

## Slice 3 — Workspace lokasi
RabNode import (parser lama diport) dgn preview+validasi+commit; revisi+lineage; Baseline versioned + edit; WeeklyPlan; tab Progress (plan vs aktual, deviasi, kurva-S); Issue+Recovery.

## Slice 4 — Pelaksanaan harian terpadu
DailyReport tunggal + workflow; `/hari-ini` mobile input-first (draft lokal + idempotent submit + kompresi foto client); verifikasi SM satu layar; enrichment KKP; cetak harian; snapshot final.

## Slice 5 — Keuangan
Budget/Commitment/Expense/Invoice/PaymentOut/OwnerBilling/Disbursement + approval + formula (calc layer tunggal) + halaman keuangan (KPI klik-tembus + AG Grid + form transaksi).

## Slice 6 — Administrasi & laporan
AdminMilestone workflow + Document Center + laporan periodik (calculation layer sama) + export xlsx server-side (exceljs) + cetak KKP mingguan/bulanan.

## Definition of Done
Lihat prompt §38 + TEST_PLAN. Dokumen (CLAUDE/PROJECT/README/DECISIONS) diupdate agar = kode.

## Scope yang DITUNDA secara sadar (dicatat jujur di laporan akhir)
- Peta Leaflet (fitur lama yang berfungsi; port menyusul setelah inti stabil).
- PWA offline penuh (service worker + background sync) — slice 4 menyiapkan draft lokal (localStorage) + idempotency; SW installable menyusul.
- PR/PO/receiving granular — direpresentasikan via Commitment + Expense (didokumentasikan); receiving flow eksplisit menyusul.
- WA-text suggestion source (fitur lama jarang dipakai; state disimpan di model, UI menyusul).
