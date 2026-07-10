# RAILWAY.md

Setup deployment KNMP Monitor di Railway. Follow urutan.

---

## 1. Buat Project Railway

1. Login ke [railway.app](https://railway.app)
2. New Project → Empty Project → nama: `knmp-monitor`
3. Add Service → GitHub → pilih repo `knmp-monitor` (branch `main`)

## 2. Provision Postgres

1. Add Service → Database → PostgreSQL 17
2. Setelah provisioning selesai, klik service → Variables
3. Copy `DATABASE_URL` — auto-inject ke web service

## 3. Provision Redis

1. Add Service → Database → Redis 7
2. Copy `REDIS_URL` — auto-inject ke web service

## 4. Enable Postgres Extensions

Setelah Postgres running:

```bash
# Connect ke Postgres via Railway CLI:
railway connect postgres

# Di psql prompt:
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

# Verify:
\dx
```

Atau otomatis via migration file `prisma/migrations/*_enable_extensions/migration.sql`
(perlu dibuat — lihat `docs/OPEN_ISSUES.md`).

## 5. Set Environment Variables

Web service → Variables → tambah:

```
AUTH_SECRET=<generate: openssl rand -base64 32>
AUTH_URL=https://<railway-generated-domain>.up.railway.app
AUTH_TRUST_HOST=true

R2_ACCOUNT_ID=<dari Cloudflare>
R2_ACCESS_KEY_ID=<dari Cloudflare R2 API token>
R2_SECRET_ACCESS_KEY=<dari Cloudflare R2 API token>
R2_BUCKET_NAME=knmp-photos
R2_PUBLIC_HOSTNAME=<optional custom domain>

WAHA_API_URL=<url WAHA bot yang sudah jalan>
WAHA_API_KEY=<key>
WAHA_SESSION_NAME=knmp

FEATURE_WAHA_OTP=false          # true di production
FEATURE_OFFLINE_MODE=false
FEATURE_MULTI_TENANT=false

SESSION_HOURS_SM=720
SESSION_HOURS_PM=168
SESSION_HOURS_EXEC=24

PHOTO_MAX_AGE_HOURS=24
PHOTO_DEFAULT_GEOFENCE_M=500

NODE_ENV=production
```

`DATABASE_URL` dan `REDIS_URL` auto-injected dari service Railway.

## 6. Configure Build & Start

Web service → Settings → 

**Build Command**:
```
pnpm install && pnpm db:generate && pnpm build
```

**Start Command**:
```
pnpm db:migrate:deploy && pnpm start
```

**Health Check Path**: `/api/health` (butuh dibuat — lihat OPEN_ISSUES.md)

**Watch Paths**: default (semua)

## 7. Setup R2 Bucket

1. Cloudflare Dashboard → R2 Object Storage
2. Create Bucket: `knmp-photos`
3. Bucket → Settings → CORS:
   ```json
   [
     {
       "AllowedOrigins": ["https://<railway-domain>", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "POST"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. Create API Token → Object Read & Write → paste ke env vars

## 8. Deploy

Railway auto-deploy setelah push ke `main`. Watch logs di dashboard.

**Common errors**:
- `PrismaClientInitializationError` → cek `DATABASE_URL` + extensions enabled
- `Cannot find module '@node-rs/argon2'` → cek Alpine base image support, atau install `@node-rs/argon2-android-arm64` sebagai fallback
- Build timeout → tambah cache, atau upgrade plan

## 9. Custom Domain

1. Railway service → Settings → Domains → Custom Domain
2. Set DNS di provider domain: CNAME ke Railway target
3. SSL otomatis via Let's Encrypt

## 10. Worker Service (untuk BullMQ)

Setelah v0.7:

1. Add Service → same GitHub repo
2. Start Command: `pnpm tsx src/worker.ts`
3. Environment vars: sama seperti web service
4. No health check needed

## 11. Cron Jobs

Weekly report Sabtu 23:00:

- Option A: Railway Cron (managed, gratis di free tier)
- Option B: `node-cron` di worker service

Belum di-implement — post-MVP.

## 12. Backup Strategy

Railway Postgres punya daily backup default. Untuk extra safety:

- Weekly manual snapshot ke S3 (via cron)
- Verify restore quarterly

## Monitoring

**Built-in Railway**:
- Metrics: CPU, memory, network
- Logs: full text search 7 hari

**External** (recommended):
- Sentry untuk error tracking → `SENTRY_DSN` env
- Umami untuk usage analytics
- Uptime monitoring (UptimeRobot, Better Stack)

## Cost Estimate

Railway free tier: 500 jam execution + $5 credit.
Production real:

| Service | Est. cost/bulan |
|---|---|
| Web (2 GB RAM) | $10-15 |
| Worker (1 GB RAM) | $5-8 |
| Postgres 17 (10 GB) | $10 |
| Redis 7 | $5 |
| Cloudflare R2 (30 GB storage) | $0.50 |
| R2 operations (100k PUT/mo) | $0.50 |
| **Total** | **~$30-40/bulan** |

Untuk 83 lokasi active, ini murah.

## Troubleshooting

**"Application failed to respond"**:
- Cek startCommand berjalan
- Cek PORT env — Railway inject `PORT`, Next.js baca via `process.env.PORT`
- Cek health check path benar

**Prisma migration stuck**:
- `railway run pnpm prisma migrate resolve --applied <migration_id>`
- Atau restore dari snapshot

**High latency**:
- Railway region: pilih `Asia Southeast (Singapore)` untuk user Indonesia
- Enable Postgres connection pooling
