# CLAUDE.md

Instruksi untuk Claude Code saat bekerja di repo ini.

**Baca file ini dulu**, lalu:
1. [`PROJECT.md`](./PROJECT.md) — arsitektur & keputusan design (single source of truth)
2. [`docs/OPEN_ISSUES.md`](./docs/OPEN_ISSUES.md) — bug + TODO sebelum fitur baru
3. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — decision log append-only (051 = rebuild total)
4. [`docs/rebuild/`](./docs/rebuild/) — artefak rebuild 2026-07-14 (domain model, permission matrix, IA, dst.)

---

## Konteks Cepat

- **Sistem**: MARLIN — pengendalian proyek Kampung Nelayan Merah Putih (KNMP)
- **Skala**: 83 lokasi, 7 provinsi; arsitektur menargetkan 200+
- **User utama**: Site Manager & Mandor lapangan (umumnya gaptek) + manajemen
- **Alur inti**: Paket (prospek→tender→kontrak→pelaksanaan→serah terima) → Lokasi →
  RAB (revisi + lineage) → Baseline kurva-S → Laporan Harian terpadu
  (draft→dikirim→perlu_koreksi→disetujui→final) → Progress → Keuangan transaksional →
  Laporan KKP
- **State**: hasil rebuild total 2026-07-14 (DECISIONS 051). Belum production.

## Prinsip WAJIB

1. **Bahasa Indonesia untuk UI text, English untuk identifier kode** (enum status domain = Indonesia).
2. **PROJECT.md single source of truth** — konflik kode vs PROJECT.md ⇒ kode salah.
   Ubah keputusan ⇒ tanya user ⇒ append `docs/DECISIONS.md`.
3. **Setiap mutasi server action**: `requireCapability()` (+ `requireLocationAccess`
   bila menyangkut lokasi) + `audit()`. Frontend hanya menyembunyikan menu.
4. **Angka agregat selalu derived** — jangan pernah bikin kolom agregat yang diedit manual.
5. **Status hanya berubah lewat mesin transisi** `src/lib/lifecycle.ts` + tulis histori.
6. Bug baru → `docs/OPEN_ISSUES.md`; keputusan baru → `docs/DECISIONS.md`.

## Commands

```bash
pnpm dev                 # dev server
pnpm typecheck           # WAJIB sebelum commit
pnpm lint
pnpm vitest run tests/unit
DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
  pnpm vitest run tests/integration    # butuh migrate deploy dulu ke DB test
pnpm build               # prisma generate + next build (standalone)
pnpm test:e2e            # Playwright (butuh server + seed)

pnpm db:generate         # regenerate Prisma Client (Prisma 7 → src/generated/prisma)
pnpm db:migrate          # migration dev
pnpm db:seed             # seed dev (idempotent; password semua user: marlin123)
pnpm db:reset            # guarded (tolak production / DB non-dev)

docker build --no-cache -t marlin:test .   # verifikasi deploy
```

## Stack (pinned exact — lihat docs/rebuild/TECHNOLOGY_AUDIT.md)

Node 24 LTS · pnpm 11 (corepack) · Next 16 App Router · React 19 · TS 5.9 ·
Prisma 7 + @prisma/adapter-pg (client di `src/generated/prisma`) · PostgreSQL 16+ ·
Tailwind 4 · Zod 4 · AG Grid Community 36 (DILARANG Enterprise) · auth custom
session-DB (BUKAN next-auth) · R2 via aws-sdk · sharp · exceljs.
Deploy: Railway + Dockerfile (DILARANG Nixpacks/Railpack).

## Struktur

```
src/
├── app/(auth)/masuk, ganti-password
├── app/(app)/           # semua butuh sesi: / (command center), paket/, lokasi/,
│                        # hari-ini/, progress/, keuangan/, dokumen/, laporan/,
│                        # pengguna/, sistem/
├── app/cetak/           # print A4 tanpa shell
├── app/api/health, ready, documents/[id]
├── lib/                 # db, env (validasi+normalisasi R2), authz (capability),
│   ├── auth/            # session (DB, revocable), password, actions, page-guard
│   ├── rab/             # parsed, hps-parser, flatten, import
│   ├── scurve/          # generate (formula terverifikasi — JANGAN ubah tanpa test paritas)
│   ├── daily-report/    # actions + queries workflow laporan
│   ├── finance/         # calc (SATU-satunya tempat formula agregat) + actions
│   ├── milestones/      # template 45 item KKP + actions
│   ├── progress.ts      # SATU calculation layer progress
│   └── lifecycle.ts     # mesin transisi status + label + tone
├── components/ui/       # primitives (token-based, tanpa hex)
├── components/shell/    # AppShell, nav (filter by capability)
├── components/grid/     # MarlinGrid (AG Grid Community wrapper)
└── components/knmp/     # domain: scurve-chart, kkp-*-report, photo-gallery
```

## Aturan Coding

- Uang: `BigInt` rupiah; serialisasi ke client via `bigintToString`. PPN dari
  `Contract.ppnPercent` (RAB pre-PPN, kontrak incl-PPN) — jangan hardcode.
- Volume: `Decimal(15,3)`. Datetime: `Timestamptz`; logika harian pakai
  `jakartaDateKey/jakartaToday` (Asia/Jakarta); kolom tanggal kerja = `@db.Date`.
- Server Component default; `"use client"` seperlunya; mutasi via Server Action
  (FormData + zod + `useActionState` + `Banner`).
- Tabel data → `MarlinGrid`; KPI/ringkasan → `KpiCard`; status → `StatusPill`
  dgn label/tone dari `lifecycle.ts`.
- DB snake_case via `@map`; file kebab-case; URL kebab-case Indonesia.

## Kalau Ragu

- Data model / KKP format / UX lapangan / phrasing Indonesia → tanya user (Hery —
  kritis, tidak suka basa-basi, weakness duluan).
- Auth/permission → high-stakes, tanya.
- Jangan menghidupkan kembali pola pra-rebuild (lihat DECISIONS 051 utk daftar
  yang sengaja dibuang).
