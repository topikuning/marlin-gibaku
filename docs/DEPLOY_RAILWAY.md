# Deploy ke Railway — MARLIN / KNMP Monitor

Panduan deploy v0.1 (auth + schema) ke Railway. Diverifikasi per **2026-07-10**.

> **Status kejujuran**: yang ini **layak deploy sebagai staging/testing**, **belum
> production-hardened**. Sebelum dipakai user beneran (83 lokasi), baca bagian
> [§9 Belum Production-Ready](#9-belum-production-ready). Jangan lewati.

---

## 0. Prasyarat

- Akun Railway (railway.com) — sudah punya / daftar (GitHub login).
- Repo `topikuning/marlin-gibaku` sudah di GitHub (✓).
- Branch yang mau di-deploy: `main` (merge PR #1 dulu), atau deploy langsung dari
  branch `claude/knmp-monitor-onboarding-pj2zpx` untuk test.
- (Opsional) Railway CLI untuk seed dari lokal:
  ```bash
  npm i -g @railway/cli
  railway login
  ```

Railway tidak lagi punya free tier permanen — ada **Trial** ($5 kredit) lalu plan
**Hobby $5/bulan** (usage-based). Postgres + 1 web service kecil masih di bawah
$5–10/bulan untuk skala testing.

---

## 1. Bikin Project + connect GitHub

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Pilih `topikuning/marlin-gibaku`. Authorize Railway GitHub App kalau diminta.
3. Pilih branch (`main` setelah merge, atau branch fitur untuk test).
4. Railway auto-detect Next.js. **Jangan deploy dulu** — set env + DB dulu (§2–3),
   kalau tidak, deploy pertama gagal (belum ada `DATABASE_URL`).

`railway.json` di repo sudah mengatur build/migrate/start/healthcheck — Railway
membacanya otomatis, tidak perlu isi manual di UI.

---

## 2. Tambah Postgres

1. Di canvas project → **+ New** → **Database** → **PostgreSQL**.
2. Railway provisioning Postgres (default PG16/17) + expose variabel:
   `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
3. Tidak perlu setup manual — extension `pgcrypto` di-`CREATE` otomatis oleh
   migration pertama (`pnpm db:migrate:deploy` di pre-deploy). pgcrypto = trusted
   extension di PG13+ dan tersedia di image Postgres Railway.

> Kalau nanti butuh Redis (v0.3, worker foto/BullMQ): **+ New → Database → Redis**.
> Untuk v0.1 (session JWT, belum ada worker) Redis **tidak diperlukan**.

---

## 3. Environment Variables (web service)

Buka **web service** (bukan Postgres) → tab **Variables** → tambah:

| Variable | Value | Catatan |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | **Reference variable** — klik "Add Reference" → pilih Postgres. Auto-sync kalau kredensial DB ganti. Jangan hardcode. |
| `AUTH_SECRET` | hasil `openssl rand -base64 32` | Wajib di produksi. Rahasia, jangan commit. |
| `AUTH_URL` | `https://<domain-railway-kamu>` | Isi setelah generate domain (§6). Bisa juga di-infer (trustHost=true) tapi lebih aman diset. |
| `FEATURE_WAHA_OTP` | `false` | OTP WA di-drop (DECISIONS 019). |

`NODE_ENV=production` diset otomatis oleh Railway — tidak perlu ditambah.

Generate secret cepat:
```bash
openssl rand -base64 32
```

---

## 4. Verifikasi konfigurasi build (sudah di `railway.json`)

Isi `railway.json` yang akan dipakai Railway:
```jsonc
{
  "build": {
    "builder": "NIXPACKS",
    // install → generate Prisma Client → build Next.js
    "buildCommand": "pnpm install --frozen-lockfile && pnpm db:generate && pnpm build"
  },
  "deploy": {
    // migrasi jalan SEBELUM versi baru serve traffic (idempotent, aman re-run)
    "preDeployCommand": "pnpm db:migrate:deploy",
    "startCommand": "pnpm start",
    "healthcheckPath": "/api/health",   // cek koneksi DB, 200/503
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE"
  }
}
```
Tidak ada yang perlu diubah — cukup pastikan file ini ter-commit (✓).

---

## 5. Deploy pertama

1. Setelah DB + variables siap → trigger deploy (**Deploy** / push commit baru).
2. Pantau **Build Logs**: harus lihat `pnpm install` → `prisma generate` →
   `next build` sukses (`✓ Compiled successfully`).
3. Pantau **Deploy Logs**: `preDeployCommand` jalan → Prisma apply migration
   `20260710..._init` → `CREATE EXTENSION pgcrypto` + tabel + triggers.
   Lalu `pnpm start` → Next.js listen.
4. Healthcheck `/api/health` harus balas `200 {"status":"ok","db":"up"}`.

Kalau healthcheck gagal, lihat [§10 Troubleshooting](#10-troubleshooting).

---

## 6. Generate domain + set AUTH_URL

1. Web service → **Settings** → **Networking** → **Generate Domain**
   (mis. `marlin-gibaku-production.up.railway.app`).
2. Balik ke **Variables** → set `AUTH_URL` = `https://<domain-itu>`.
3. Redeploy (ganti env var memicu redeploy otomatis).

Custom domain (mis. `marlin.domainmu.id`) bisa ditambah di Networking → Custom
Domain → set CNAME di DNS provider.

---

## 7. Seed data (sekali, opsional untuk testing)
<!-- anchor: seed -->


Deploy hanya bikin schema kosong — **belum ada user**. Untuk smoke test dengan
demo user, seed sekali dari lokal (Railway CLI menyuntik env DB Railway):

```bash
railway link            # pilih project + service
railway run pnpm db:seed
```

Ini bikin 3 kontraktor, 7 lokasi, dan 7 demo user (password `password123`).

> **PENTING**: `password123` = DEV ONLY. Untuk data produksi, **jangan** seed demo
> user — provisioning user riil (dan ganti password) via admin panel (belum ada,
> TODO) atau langsung insert dengan `password_hash` Argon2id. Seed demo hanya untuk
> membuktikan flow login jalan.

---

## 8. Smoke test

1. Buka `https://<domain>/masuk`.

2. Login `admin` / `password123` → harus mendarat di `/beranda` dengan role
   "Super Admin".
3. Coba `mandor-01` / `password123` → role "Mandor", lihat 2 lokasi tertugas.
4. `https://<domain>/api/health` → `{"status":"ok","db":"up"}`.

Kalau keempat ini jalan, deploy v0.1 sukses.

---

## 9. Belum Production-Ready (baca sebelum go-live)

Deploy ini **cukup untuk testing/demo**, TIDAK aman untuk 83 lokasi produksi:

- 🔴 **Tidak ada rate limiter login** — brute-force terbuka (auth cuma password,
  tanpa OTP/device — DECISIONS 019). Wajib sebelum publik.
- 🔴 **RLS belum ditulis** — semua query bisa akses semua data lintas lokasi.
- 🔴 **Belum ada test otomatis** — regresi tidak terjaga.
- 🟡 **Belum ada monitoring** (Sentry/Umami) — error/usage tidak ke-track.
- 🟡 **Password demo lemah** + belum ada enforce ganti password first-login.
- 🟡 **Force-logout/revocation belum ada** (JWT stateless).
- 🟡 **Backup**: aktifkan Railway automated backup di Postgres service.

Lihat `docs/OPEN_ISSUES.md` untuk daftar lengkap.

---

## 10. Troubleshooting

| Gejala | Kemungkinan sebab | Fix |
|---|---|---|
| Build gagal di `pnpm install` | lockfile out of sync | commit `pnpm-lock.yaml` terbaru; atau ganti buildCommand ke `pnpm install` (tanpa `--frozen-lockfile`) sementara |
| `prisma migrate deploy` error `permission denied to create extension "pgcrypto"` | user DB bukan superuser/owner | Railway default user = owner, harusnya OK. Kalau tetap gagal: hapus `pgcrypto` dari `datasource.extensions` + baris `CREATE EXTENSION` di migration (gen_random_uuid sudah core di PG13+) |
| Healthcheck timeout / 503 | `DATABASE_URL` salah / DB belum siap | pastikan pakai reference `${{Postgres.DATABASE_URL}}`; cek Postgres service running |
| `MissingSecret` / auth error | `AUTH_SECRET` belum diset | set `AUTH_SECRET` (§3) |
| Login redirect loop / CSRF error | `AUTH_URL` salah domain | set `AUTH_URL` = domain publik persis (https) |
| `@node-rs/argon2` load error | binary platform tidak cocok | Railway = linux glibc, prebuilt `linux-x64-gnu` tersedia (✓). Kalau muncul, cek arch service |
| Migrasi tidak jalan | `preDeployCommand` tidak terbaca | pastikan `railway.json` ter-commit di branch yang di-deploy |

---

## Ringkasan urutan (TL;DR)

```
1. New Project → deploy from GitHub repo (marlin-gibaku)
2. + New → Database → PostgreSQL
3. web service → Variables:
     DATABASE_URL = ${{Postgres.DATABASE_URL}}
     AUTH_SECRET  = <openssl rand -base64 32>
     AUTH_URL     = (isi setelah step 5)
     FEATURE_WAHA_OTP = false
4. Deploy → cek build + pre-deploy migrate + healthcheck hijau
5. Settings → Networking → Generate Domain → set AUTH_URL → redeploy
6. (opsional) railway run pnpm db:seed  → smoke test login
```

Sumber panduan (diverifikasi 2026-07): Railway docs (deploy Next.js, PostgreSQL),
Prisma deploy-to-Railway, Railway Central Station (Postgres extensions).
