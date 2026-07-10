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

## Sesi 3 (lanjutan) · 2026-07-10 — Deploy Railway + Fitur Aplikasi

Setelah auth + deploy jalan (marlin.gibaku.com), user minta "lakukan semua fitur,
bertahap". Dibangun bertahap, tiap fitur 1 PR + merge + auto-deploy:

- **Deploy Railway**: seed otomatis via `scripts/release.sh` + `SEED_ON_DEPLOY`
  (tanpa setup lokal). Badge versi build di footer.
- **App shell**: header + navigasi role-aware (item belum ada = "segera").
- **Lokasi**: daftar + detail (kontrak + ringkasan RAB) — role-scoped.
- **RAB tree**: `/lokasi/[slug]/rab` — kategori→sub-item, collapsible.
- **Pengguna**: provisioning user (admin), authz server-side.
- **Lapor Harian**: mandor input volume → draft → SM approve/tolak → DailyReport
  (state machine, DECISIONS 005/018). Inti produk.
- **Dashboard**: realisasi vs rencana kurva-S + deviasi per lokasi.
- **Kontrak & Kontraktor**: master data (create).

Semua diverifikasi runtime/E2E (Playwright + Postgres) sebelum merge. Pola:
tiap fitur di-scope role-aware + authz di level data (bukan cuma sembunyi nav).

**Belum (production-hardening, prioritas sebelum go-live)**: rate limiter login
(🔴), RLS policies (🔴), test otomatis (🔴), foto/R2, chart kurva-S visual,
weekly plan editor, export KKP.

---

## Sesi 3 · 2026-07-10 (Claude Code) — Schema Refactor + Auth Flow

**Konteks**: user (Hery) jawab 5 pertanyaan klarifikasi → beberapa membalik
keputusan yang sudah di-lock. Semua override di-log di DECISIONS 016-022.

**Keputusan user (override)**:
1. Contract **1:N** Location (bukan 1:1) → DECISIONS 016
2. Contractor jadi tabel terpisah → DECISIONS 017
3. Mandor (`field_supervisor`) jadi **role login** + multi-lokasi → DECISIONS 018
4. Auth = **username/email + password**, tanpa OTP/device binding → DECISIONS 019
5. "Coding dulu" (langsung eksekusi)

**Selesai (terverifikasi end-to-end di Postgres 16 ephemeral)**:
- ✓ Schema refactor: `contractors` table, Contract 1:N Location, `field_supervisor`
  role, `username`/`password_hash`, `phone_e164` nullable
- ✓ **Migrasi DB pertama** (`20260710..._init`): pgcrypto (postgis di-drop, 020),
  CHECK constraints (dual-parent RAB item + photo, login identifier), append-only
  triggers 4 tabel — **diverifikasi memblokir UPDATE/DELETE**
- ✓ `src/lib/bigint.ts`, `src/lib/password.ts` (Argon2id), `src/lib/schemas/auth.ts`
- ✓ Auth.js v5: `src/auth.config.ts` (edge) + `src/auth.ts` (node) + `src/middleware.ts`
  + route handler. Login by username **atau** email, JWT per-role expiry (021)
- ✓ Pages: `/masuk` (login), `/beranda` (role + lokasi assignment), root redirect
- ✓ `/api/health` + `railway.json`
- ✓ Seed rewrite: 3 contractors, 7 lokasi, 11009 RAB items, 154 milestones, 7 demo
  user per role (mandor 2 lokasi, regional 5, pm 3)
- ✓ Fix scaffold gaps: `.gitignore` (hilang!), `.env.example`, ESLint flat config
- ✓ Verifikasi: `tsc` clean, `eslint` 0 error, `pnpm build` sukses, login flow
  (admin/mandor/email) + wrong-password reject + middleware redirect semua PASS

**Bug ditemukan** (lihat OPEN_ISSUES "Ditemukan Sesi 3"):
- Parser HPS hasilkan kode subkategori duplikat (batah-timur) — di-workaround di seed
- RabItem self-relation harus `onDelete: Cascade` (022) — ketemu saat seed
- Belum ada test otomatis (auth diverifikasi manual)

**Login dev**: username `admin` / password `password123` (juga: `mandor-01`,
`sm-kedungmutih`, `direktur`, `regional-jateng`, `pm-nusantara`, `exec-kkp`).

**NEXT (blocker sebelum v0.2)**: user perlu putuskan flow mandor — submit langsung
vs SM approve (DECISIONS 018). Lalu: role-based authorization per-route di middleware
(sekarang cuma cek login), RLS policies, rate limiter login (naik Critical).

---

## Sesi 3 · Rencana awal (tercapai sebagian besar) — Auth Flow + Fixes

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
