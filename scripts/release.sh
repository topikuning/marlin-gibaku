#!/usr/bin/env sh
# Dijalankan Railway sebagai preDeployCommand (di dalam container, SEBELUM versi
# baru serve traffic). Tidak butuh setup lokal apa pun.
#
# 1. Apply migrasi DB (idempotent, aman re-run tiap deploy).
# 2. Seed demo data HANYA kalau SEED_ON_DEPLOY=true (set di Railway Variables).
#    Seed idempotent (upsert) — aman, tapi demo user pakai password lemah, jadi
#    matikan flag setelah data awal masuk / sebelum dipakai user produksi.
set -e

echo "→ prisma migrate deploy..."
pnpm db:migrate:deploy

if [ "$SEED_ON_DEPLOY" = "true" ]; then
  echo "→ SEED_ON_DEPLOY=true → seeding demo data..."
  pnpm db:seed
else
  echo "→ SEED_ON_DEPLOY bukan 'true' → skip seed."
fi

echo "✓ release selesai."
