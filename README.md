# MARLIN

Sistem pengendalian proyek **Kampung Nelayan Merah Putih (KNMP)** — 83 lokasi,
7 provinsi. Satu alur dari prospek/tender sampai FHO: paket → kontrak → lokasi →
RAB & baseline → pelaksanaan harian → verifikasi → progress → keuangan →
laporan KKP → serah terima.

> Hasil rebuild total 2026-07-14 — lihat `docs/rebuild/` untuk audit, domain model,
> permission matrix, dan rencana. Status: pra-production.

## Stack

| Layer | Teknologi |
|---|---|
| Runtime | Node.js 24 LTS · pnpm 11 (Corepack) |
| Web | Next.js 16 (App Router, standalone) · React 19 · TypeScript 5.9 |
| Data | PostgreSQL 16+ · Prisma 7 (+`@prisma/adapter-pg`) |
| UI | Tailwind CSS 4 (design tokens) · AG Grid Community 36 · lucide-react |
| Auth | Custom: session DB revocable, argon2id, capability-based authorization |
| File | Cloudflare R2 (S3 API) · sharp (kompresi+stamp foto) |
| Validasi | Zod 4 di semua boundary |
| Test | Vitest 4 (unit+integration) · Playwright (E2E) |
| Deploy | Railway via **Dockerfile** (multi-stage, non-root, tini) |

Semua dependency open-source, dipin exact, diaudit lisensi & keamanan di CI.

## Menjalankan lokal

```bash
corepack enable                      # pnpm 11 dari packageManager
pnpm install --frozen-lockfile
cp .env.example .env                 # isi DATABASE_URL + SESSION_SECRET (R2 opsional)
pnpm db:migrate                      # apply migrations
pnpm db:seed                         # data demo (7 lokasi riil, ~14k item RAB)
pnpm dev                             # http://localhost:3000
```

Login dev (password semua: `marlin123`): `admin` (super admin), `hery` (direktur),
`am-jateng`, `pm-01`, `sm-01`, `sm-02` (wajib ganti password), `mandor-01`, `kkp-viewer`.

## Verifikasi

```bash
pnpm typecheck && pnpm lint
pnpm vitest run tests/unit
DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
  pnpm prisma migrate deploy && \
DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
  pnpm vitest run tests/integration
pnpm build && pnpm test:e2e
docker build --no-cache -t marlin:test .
```

CI (GitHub Actions): license audit → security audit → typecheck → lint → unit →
integration (Postgres service) → build → docker build → E2E.

## Deploy (Railway)

Builder **DOCKERFILE** (`railway.json`), pre-deploy `prisma migrate deploy`,
healthcheck `/api/health` (proses+DB; R2 sengaja bukan hard-dependency —
diagnostik R2 di `/api/ready` dan menu Sistem). Env wajib: `DATABASE_URL`,
`SESSION_SECRET`, `APP_ENV=production`; R2: `R2_ENDPOINT` (endpoint S3
`<accountid>.r2.cloudflarestorage.com`, bukan r2.dev), `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## Dokumentasi

- **`docs/DEPLOY_RAILWAY.md` — panduan deploy Railway langkah demi langkah**
- `PROJECT.md` — arsitektur & keputusan (source of truth)
- `docs/DECISIONS.md` — log keputusan append-only
- `docs/OPEN_ISSUES.md` — hutang teknis terbuka
- `docs/rebuild/` — artefak rebuild (audit, domain model, permission, test plan, dst.)
- `docs/DEPENDENCY_POLICY.md` — kebijakan dependency & lisensi
