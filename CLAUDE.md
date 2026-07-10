# CLAUDE.md

Instruksi untuk Claude Code saat bekerja di repo ini.

**Baca file ini dulu**, lalu baca:
1. [`PROJECT.md`](./PROJECT.md) — keputusan design/arsitektur (single source of truth)
2. [`docs/OPEN_ISSUES.md`](./docs/OPEN_ISSUES.md) — bug + TODO yang HARUS dibetulkan sebelum fitur baru
3. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — decision log append-only

---

## Konteks Cepat

- **Sistem**: Monitoring proyek Kampung Nelayan Merah Putih (KNMP)
- **Skala**: 83 lokasi di 7 provinsi
- **User utama**: Site Manager (SM) di lapangan, umumnya gaptek
- **Tujuan**: satu input harian → generate laporan internal + KKP sekaligus
- **State sekarang**: v0 scaffold (foundation only). Semua fitur harus dibangun.

## Prinsip yang WAJIB dipatuhi

1. **Bahasa Indonesia untuk UI text, English untuk kode identifier**
2. **PROJECT.md adalah single source of truth**. Kalau ada konflik antara kode dan PROJECT.md, kode yang salah — betulkan. Kalau kamu ingin ubah keputusan yang sudah di PROJECT.md, tanya user dulu, lalu append di `docs/DECISIONS.md`.
3. **Setiap keputusan design baru** → append ke `docs/DECISIONS.md` dengan tanggal, alasan, alternatif yang di-reject
4. **Setiap fitur baru** → update PROJECT.md section yang relevan
5. **Setiap bug baru ditemukan** → tambah ke `docs/OPEN_ISSUES.md`

## Working Style

- **User (Hery) prefer**: kritis, precise, evidence-aware. Tidak suka disanjung. Kalau salah, akui dengan singkat.
- **Weakness paling penting duluan** — surface it before answering.
- **Fragments OK**. Drop filler. Jangan bertele-tele.
- **Kalau ragu, tanya** — bukan asumsi. Tapi hindari pertanyaan trivial atau prematur.
- **Kalau user mengeluh soal pertanyaan** ("konyol", "premature"), turuti — jangan defensif.

## Commands yang sering dipakai

```bash
# Development
pnpm dev                    # dev server
pnpm typecheck             # WAJIB sebelum commit
pnpm lint

# Database
pnpm db:generate           # regenerate Prisma Client setelah edit schema
pnpm db:migrate            # dev migration
pnpm db:studio             # GUI untuk inspect data
pnpm db:seed               # re-seed dari seed-data/*.json

# Re-parse HPS baru
python scripts/generate_seed.py

# Deploy
pnpm build                 # local build test
pnpm db:migrate:deploy     # production migration
```

## Struktur Repo

```
src/
├── app/
│   ├── (auth)/            # login, register
│   ├── (app)/             # main app after auth
│   │   ├── beranda/       # SM home
│   │   ├── laporan/       # SM submit report
│   │   └── ...
│   ├── (admin)/           # super_admin only
│   │   ├── users/
│   │   ├── locations/
│   │   ├── contracts/
│   │   └── ...
│   ├── api/               # API routes
│   └── layout.tsx
├── lib/
│   ├── db.ts              # Prisma singleton
│   ├── auth.ts            # Auth.js config (BELUM ADA)
│   ├── r2.ts              # R2 client (BELUM ADA)
│   ├── scurve.ts          # S-curve algorithm
│   └── bigint.ts          # BigInt serializer (BELUM ADA)
├── components/
│   ├── ui/                # shadcn-style base primitives
│   └── knmp/              # domain components
└── styles/
```

## Aturan Coding

### TypeScript
- **Strict mode enabled**. Jangan skip type errors.
- **Zod schema** untuk semua input/output boundary (API + forms).
- **Prisma types** langsung dipakai; tidak perlu wrapping berlebih.

### Server / Client Components
- Default **Server Component**. `"use client"` cuma kalau perlu (state, event handler).
- **Server Actions** untuk mutation. API routes cuma untuk external integration.

### Money (Rupiah)
- Storage: `BigInt` (integer, tidak float — floating point tidak akurat untuk uang)
- Display: format dengan `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' })`
- Serialization API: convert BigInt ke string (JSON.stringify tidak support BigInt native)

### Volume (Prisma Decimal)
- Storage: `Decimal(15, 3)` — 3 desimal cukup untuk m³, kg, dll
- TypeScript: `Prisma.Decimal` → convert ke `number` cuma saat display

### Datetime
- Storage: `Timestamptz` (Postgres time with timezone)
- App logic: pakai `date-fns` dengan tz `Asia/Jakarta`
- Never pakai `new Date()` untuk business logic tanpa timezone explicit

### Naming
- DB: `snake_case` (via Prisma `@map` / `@@map`)
- TypeScript: `camelCase` untuk properties, `PascalCase` untuk types
- Files: `kebab-case.ts`
- URLs: `/kebab-case`
- Bahasa Indonesia untuk UI text (label, button, message)

## Alur Development Standar (untuk fitur baru)

1. **Cek PROJECT.md** — fitur ini sudah didecide belum? Ada konsen apa?
2. **Cek OPEN_ISSUES.md** — ada bug pre-existing yang harus dibetulkan dulu?
3. **Draft plan** — kasih user summary singkat: apa yang akan dibangun, di mana, model change apa
4. **Tunggu user OK** — jangan langsung code kalau tidak jelas
5. **Update schema** (kalau perlu) → `pnpm db:generate` → `pnpm db:migrate`
6. **Build feature** — server component dulu, tambah interactivity secukupnya
7. **Test** — minimum `pnpm typecheck` + `pnpm lint`
8. **Update docs** — PROJECT.md kalau ada design keputusan baru, DECISIONS.md kalau override
9. **Commit** — Conventional Commits

## Kalau Ragu

- **Data model change** → tanya user, jangan asumsi
- **Auth/security** → tanya, ini high-stakes
- **KKP format** → tanya user, dia yang tahu spec resmi
- **UX gaptek user** → tanya, dia yang tahu realita lapangan
- **Bahasa Indonesia phrasing** → user reviewer, kalau ragu tanya

## Kalau Break

- **Jangan panic delete** — commit + branch dulu
- **Prisma migration break** → `prisma migrate resolve` atau rollback via git + re-migrate
- **RLS lock user out** → temporary disable via `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` sebagai admin, betulkan policy, re-enable

## Yang Sedang Dikerjakan (State per 10 Jul 2026)

Lihat [`docs/SESSION_LOG.md`](./docs/SESSION_LOG.md) untuk status paling baru.

Ringkasan cepat:
- ✓ v0 scaffold (schema + seed + placeholder page)
- **NEXT**: v0.1 auth flow (login page, session, middleware) — mulai dari sini
- After: v0.2 SM core flow (RAB tree, submit report)
- Then: R2 upload, PM dashboard, exec dashboard, exports, deploy

## Kontak

- User: Hery (program director, PT [nama])
- Repo: [diisi]
- Deploy target: Railway
