# DEPLOYMENT ARCHITECTURE — MARLIN Rebuild

## Kondisi lama

Railway **Nixpacks** (tanpa Dockerfile), `pnpm start` (bukan standalone), preDeploy `scripts/release.sh` (migrate deploy + seed opsional), healthcheck `/api/health` (DB only). Tanpa CI. → Semua diganti.

## Target

```
GitHub push → GitHub Actions CI (lihat .github/workflows/ci.yml)
            → Railway build via Dockerfile (builder DOCKERFILE, bukan Nixpacks/Railpack)
              multi-stage: base → deps → builder → runner
              node:24.18.0-bookworm-slim (pinned; bukan alpine — Prisma/sharp/OpenSSL)
              corepack + pnpm 11.13.0, install --frozen-lockfile
              prisma generate → next build (output: standalone)
              runner: non-root (uid 1001), NODE_ENV=production, tini sebagai PID 1,
              CA certificates + OpenSSL runtime, bind 0.0.0.0:$PORT
            → preDeploy: pnpm prisma migrate deploy (TIDAK pernah migrate dev/reset di deploy)
            → healthcheck GET /api/health (proses + DB; R2 TIDAK hard-dependency)
```

- `/api/health` — liveness+DB. `/api/ready` — diagnostic R2/ENV terpisah (gangguan R2 ≠ restart app).
- `railway.json`: builder DOCKERFILE, healthcheckPath/timeout, restartPolicy ON_FAILURE, preDeployCommand migrate deploy.
- `.dockerignore`: node_modules, .next, .git, docs, artifacts, seed-data mentah tidak dibutuhkan runtime (seed jalan dari dev, bukan container prod).
- Env tervalidasi saat startup via zod (`src/lib/env.ts`): DATABASE_URL, SESSION_SECRET, R2_* (normalisasi endpoint: trim, URL valid, https, tanpa r2.dev), APP_ENV.
- Reset DB hanya `APP_ENV=development|test` + guard ganda.
- Verifikasi: `docker build --no-cache` + run + smoke (login, health, static, shutdown SIGTERM) — hasil dicatat `DOCKER_VERIFICATION.md`.

## CI pipeline (GitHub Actions)

Install(frozen) → License audit → Security audit (pnpm audit prod, fail on critical) → Typecheck → Lint → Unit (Vitest) → Integration (Postgres service container, migrate+seed+test) → Build → Docker build → E2E (Playwright, Chromium).
