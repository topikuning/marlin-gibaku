# KNMP Monitor

Sistem monitoring & pelaporan proyek Kampung Nelayan Merah Putih (KNMP)
untuk 83 lokasi di 7 provinsi.

**⚠ Dokumentasi keputusan design/arsitektur ada di [`PROJECT.md`](./PROJECT.md).
Baca dulu sebelum coding.**

---

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript strict
- PostgreSQL 17 + Prisma 6
- Auth.js v5 (phone + PIN + device binding)
- Cloudflare R2 (photo storage)
- Redis 7 (session cache + BullMQ)
- Tailwind CSS 4
- Deploy: Railway

## Prerequisites

- Node.js 22 LTS
- pnpm 9+
- PostgreSQL 17 (lokal atau Railway)
- Python 3.10+ (untuk regenerate seed dari HPS baru)

## Setup

```bash
# 1. Install
pnpm install

# 2. Copy env
cp .env.example .env.local
# Isi DATABASE_URL minimal untuk dev

# 3. Migrate DB
pnpm db:migrate

# 4. Seed 7 lokasi dari HPS
pnpm db:seed

# 5. Jalankan dev
pnpm dev
```

Buka [http://localhost:3000](http://localhost:3000) — kalau muncul angka
lokasi/users/RAB items, foundation siap.

**Login dev**: `+6281234567890` / PIN `123456` (jangan pakai di production).

## Struktur Project

```
knmp-monitor/
├── PROJECT.md              ← keputusan design/arsitektur (single source of truth)
├── prisma/
│   ├── schema.prisma       ← 21+ tabel
│   └── seed.ts             ← load 7 lokasi HPS
├── src/
│   ├── app/                ← Next.js App Router
│   ├── lib/
│   │   ├── db.ts           ← Prisma client
│   │   └── scurve.ts       ← S-curve auto-generator
│   └── components/         ← UI components
├── scripts/
│   ├── parse_hps.py        ← HPS Excel → JSON parser
│   ├── generate_seed.py    ← batch parse 7 HPS
│   └── scurve.py           ← S-curve algorithm (Python reference)
└── seed-data/              ← JSON hasil parse HPS (7 lokasi)
```

## Regenerate Seed dari HPS Baru

Kalau ada HPS lokasi baru:

```bash
# 1. Taruh HPS di /path/to/hps/
# 2. Edit scripts/generate_seed.py → tambah entry di LOCATIONS_META
# 3. Jalan parser:
python scripts/generate_seed.py

# 4. Re-seed DB
pnpm db:seed
```

## Commands

| Command | Fungsi |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Migrate DB (dev) |
| `pnpm db:migrate:deploy` | Migrate DB (prod) |
| `pnpm db:seed` | Load seed data |
| `pnpm db:studio` | Prisma Studio (GUI) |
| `pnpm db:reset` | Reset + re-seed (DESTRUCTIVE) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | E2E tests (Playwright) |

## Roadmap

Lihat [`PROJECT.md` section 10](./PROJECT.md#10-roadmap-coding).

Current state: **v0 · Scaffold (this)**.

## Contributing

- Bahasa Indonesia untuk UI, English untuk kode
- Conventional Commits
- Feature branches: `feature/{scope}`
- Semua keputusan arsitektur → append ke `PROJECT.md`

## License

Proprietary. Untuk keperluan internal PT [nama] × Program KNMP KKP RI.
