# SESSION_LOG.md

Status coding paling baru + rencana sesi berikutnya. Update setiap akhir sesi.

---

## Sesi 1 · 2026-07-09 (chat.claude.ai) — Discovery & Design

**Selesai**:
- ✓ Requirement gathering
- ✓ Architecture design (`docs/DECISIONS.md` 001-015)
- ✓ Data model (21 tabel Prisma schema)
- ✓ 4 iterasi prototype UI (v1, v2, v3, v3.1) — di zip terpisah
- ✓ S-curve algorithm baseline + KKP Back-up Data Excel generator
- ✓ HPS parser (7 file lokasi berhasil parse)

**Deliverables**:
- Prototype HTML files (untuk referensi UI)
- Excel samples (KKP Back-up + Kurva-S)

---

## Sesi 2 · 2026-07-10 (chat.claude.ai) — Scaffold v0

**Selesai**:
- ✓ `PROJECT.md` (15 sections)
- ✓ `prisma/schema.prisma` — 21 tabel, semua enum, semua index
- ✓ `prisma/seed.ts` — ingest 7 lokasi + generate S-curve milestones
- ✓ `src/lib/scurve.ts` — TS port
- ✓ `src/lib/db.ts` — Prisma singleton
- ✓ `package.json` dengan locked deps (Next.js 15, Prisma 6, Auth.js v5)
- ✓ Config files (tsconfig, next.config, tailwind, postcss)
- ✓ Seed data (7 JSON files, 361 items dengan volume + unit)
- ✓ Placeholder home page dengan health check
- ✓ README, .env.example, .gitignore
- ✓ CLAUDE.md, docs/DECISIONS.md, docs/OPEN_ISSUES.md, docs/SESSION_LOG.md (this)

**Belum selesai / diakui minimal**:
- Halaman aplikasi cuma 1 (health check)
- Auth flow: nol
- API routes: nol
- Master data pages: nol
- RLS policies: mention tapi belum ada SQL
- Audit log middleware: belum
- Append-only triggers: belum
- Railway config file: belum
- Health check API route: belum

**Yang tidak sempat divalidasi** (perlu tanya user):
- Contract 1:1 vs 1:N (asumsi 1:1)
- Contractor table (asumsi dulu sebagai string di contracts)
- Metadata lokasi (kontraktor name, GPS, tanggal semua dikarang)
- Contract duration hardcoded 150 hari
- Budget split 55/25/10/5/3/2 (belum divalidasi)

---

## Sesi 3 · (belum, di Claude Code) — Auth Flow + Fixes

**Rekomendasi urutan**:

1. **Fix critical bugs dari OPEN_ISSUES.md dulu** sebelum tambah fitur:
   - Buat `railway.json` + health check endpoint (butuh untuk deploy sanity check)
   - Buat SQL migration `enable-extensions.sql` untuk postgis + pgcrypto
   - Buat `src/lib/bigint.ts` serializer
   - Buat CHECK constraints untuk RAB item + Photo dual-parent
   - Verify `@node-rs/argon2` bisa build di Railway

2. **Tanya user sebelum coding**:
   - Contract 1:1 atau 1:N? Kalau 1:N, refactor schema dulu
   - Contractor sebagai tabel terpisah — user setuju?
   - Format WA template dari mandor untuk parse

3. **Auth flow implementation**:
   - `src/lib/auth.ts` — Auth.js v5 config
   - Login page: input phone + PIN
   - PIN verification (Argon2)
   - Session creation (JWT, role-aware duration)
   - Middleware `src/middleware.ts` untuk route protection
   - Device fingerprint capture
   - Feature flag `FEATURE_WAHA_OTP=false` → skip OTP di dev

4. **Test auth end-to-end** — login dev user → landing sesuai role

**Estimasi**: 1-2 sesi Claude Code.

---

## Roadmap Full

Lihat `PROJECT.md` section 10.

- Sesi 3-4: Auth + fixes + basic layout
- Sesi 5-6: SM core flow (RAB tree, submit report)
- Sesi 7: R2 photo upload
- Sesi 8-9: PM dashboard + weekly plan editor
- Sesi 10: Exec dashboard + rollup
- Sesi 11: Excel/PDF export
- Sesi 12: Railway deploy + smoke test

Post-MVP paralel: WAHA integration, offline mode, deviasi UI, reforecast,
import HPS via UI.

---

## Catatan untuk Sesi Berikut

- User (Hery) prefer critical, precise, no filler. Bahasa Indonesia OK.
- Kalau ragu, tanya. Kalau salah, akui.
- Jangan asumsi format KKP resmi — tanya kalau butuh template
- Test setiap fitur end-to-end sebelum move on
