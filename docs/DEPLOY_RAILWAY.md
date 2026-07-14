# Panduan Deploy MARLIN ke Railway

Terakhir diverifikasi: 2026-07-14 (pasca rebuild total — DECISIONS 051).
Arsitektur: lihat `docs/rebuild/DEPLOYMENT_ARCHITECTURE.md`. Build memakai
**Dockerfile** (bukan Nixpacks/Railpack) — `railway.json` sudah mengaturnya.

## 0. Prasyarat

- Repo GitHub `topikuning/marlin-gibaku` (branch yang akan dideploy sudah lulus CI —
  jangan deploy kalau job **Docker build** merah).
- Akun Railway + akses buat project.
- (Untuk foto & dokumen) Bucket Cloudflare R2 + API token S3.

## 1. Buat project & service

1. Railway → **New Project** → **Deploy from GitHub repo** → pilih `marlin-gibaku`,
   branch `main` (atau branch rilis).
2. Railway otomatis mendeteksi `railway.json` → builder **DOCKERFILE**.
   **Cek di Settings → Build**: harus "Dockerfile", path `Dockerfile`.
   Kalau tertulis Nixpacks/Railpack, itu salah — periksa `railway.json` ikut ter-push.
3. Jangan set Build Command / Start Command manual — semuanya dari Dockerfile
   (`node server.js` via tini, non-root).

## 2. Provision PostgreSQL

1. Project yang sama → **+ New** → **Database → PostgreSQL** (Railway saat ini
   memakai Postgres 16/17 — keduanya didukung; schema butuh ≥16).
2. Di service aplikasi → **Variables** → tambahkan referensi:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`

## 3. Environment variables (service aplikasi)

| Variabel | Nilai | Catatan |
|---|---|---|
| `DATABASE_URL` | referensi Postgres di atas | wajib |
| `SESSION_SECRET` | hasil `openssl rand -hex 32` | wajib, min 32 char, JANGAN dibagikan |
| `APP_ENV` | `production` | wajib — mengunci seed/reset |
| `R2_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` | endpoint S3 API. **BUKAN** `*.r2.dev` / custom domain — app menolak saat startup |
| `R2_BUCKET` | nama bucket | |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | dari R2 API Token (permission Object Read & Write, scope bucket tsb) | |

R2 opsional: tanpa R2 aplikasi tetap jalan, fitur unggah foto/dokumen menampilkan
pesan "belum dikonfigurasi". Validasi env dilakukan zod saat startup — kalau salah
format, container gagal start dengan pesan jelas di log.

## 4. Migrasi database

`railway.json` sudah berisi `preDeployCommand: "prisma migrate deploy"` —
Railway menjalankannya sebelum tiap deploy (CLI prisma 7.8.0 sudah terpasang di
image). Tidak perlu tindakan manual; JANGAN pernah menjalankan `migrate dev`
atau reset di production.

## 5. Deploy pertama & verifikasi

1. Trigger deploy (push ke branch atau tombol Deploy).
2. Tunggu healthcheck hijau — `GET /api/health` harus `{"status":"ok","db":"up"}`
   (timeout 300 dtk, restart ON_FAILURE max 5; semua dari `railway.json`).
3. Cek `GET /api/ready` → `r2Configured: true` bila R2 diisi.
4. Buat admin pertama (database production kosong — seed demo menolak production).
   **Cara termudah (lewat env var, tanpa mesin dev):**
   - Service app → **Variables** → tambah `BOOTSTRAP_ADMIN_PASSWORD` = password awal
     (min 8 karakter; opsional `BOOTSTRAP_ADMIN_USERNAME`, default `admin`).
   - **Redeploy**. Saat start, aplikasi otomatis membuat admin (log deploy:
     `[bootstrap] admin 'admin' berhasil dibuat`). Aman: hanya membuat bila belum
     ada, tidak pernah menimpa user/password yang sudah ada.
   - Login `admin` + password tadi → dipaksa ganti password.
   - **Setelah berhasil login, HAPUS** `BOOTSTRAP_ADMIN_PASSWORD` (& `_USERNAME`)
     dari Variables lalu redeploy — supaya tidak tertinggal sebagai konfigurasi.
   Alternatif (dari mesin dev): script di §7.
5. (Opsional — deployment UJI COBA) Muat **data contoh** (7 lokasi riil, ~14k item
   RAB, laporan demo, keuangan demo): tambah env `BOOTSTRAP_DEMO_DATA=true` →
   redeploy → log `[bootstrap] data demo termuat`. User demo (sm-01, mandor-01,
   dst.) berpassword `marlin123`. Idempotent (aman diulang), TIDAK menimpa data
   yang ada. **Hapus env-nya setelah termuat**, dan jangan pakai bila sudah ada
   data operasional sungguhan.
6. Login → menu **Sistem** → jalankan **tes R2** (round-trip PUT/GET/presign/DELETE
   dengan diagnosis error terklasifikasi: DNS/TLS/kredensial/bucket/permission).

## 6. Custom domain (opsional)

Service → Settings → **Networking** → tambahkan domain (mis. `marlin.gibaku.com`)
→ pasang CNAME sesuai instruksi Railway. Cookie sesi `secure` otomatis aktif
karena `APP_ENV=production`.

## 7. Membuat admin pertama — alternatif via mesin dev

(Cara utama = env var bootstrap di §5.4. Alternatif ini kalau Anda punya akses
langsung ke Postgres production dari mesin dev.) Sekali saja, lalu tutup akses:

```bash
DATABASE_URL="<url postgres production>" APP_ENV=production pnpm tsx -e "
import { PrismaClient } from './src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from './src/lib/auth/password';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const org = await db.organization.upsert({ where: { slug: 'gibaku' }, update: {}, create: { name: 'PT Gibaku Bangun Persada', slug: 'gibaku' } });
await db.user.upsert({
  where: { username: 'admin' }, update: {},
  create: { orgId: org.id, username: 'admin', fullName: 'Administrator', role: 'super_admin',
    passwordHash: await hashPassword('GANTI-SEGERA-min8char'), mustChangePassword: true },
});
console.log('admin dibuat — wajib ganti password saat login pertama');
await db.\$disconnect();
"
```

`mustChangePassword: true` memaksa ganti password pada login pertama.

## 8. Operasional

- **Rollback**: Railway → Deployments → redeploy versi sebelumnya (migrasi bersifat
  forward-only; buat migrasi perbaikan, jangan edit migrasi lama).
- **Log**: Railway → Observability. Error otorisasi muncul sebagai digest Next;
  audit trail aplikasi ada di menu Sistem.
- **Update dependency/rilis**: ikuti `docs/DEPENDENCY_POLICY.md` — merge hanya
  bila CI hijau penuh (termasuk job Docker build & E2E).

## 9. Troubleshooting cepat

| Gejala | Penyebab umum |
|---|---|
| Container gagal start, log `EnvError` | `SESSION_SECRET` < 32 char / `R2_ENDPOINT` salah format (r2.dev, protokol ganda, ada path) |
| Healthcheck merah, `db: down` | `DATABASE_URL` salah / Postgres belum siap — cek referensi variabel |
| Pre-deploy gagal `Cannot find module 'prisma/config'` | prisma.config harus .js polos tanpa import paket `prisma` (CLI global di container) — sudah diperbaiki |
| Pre-deploy gagal ~3 dtk TANPA log | preDeployCommand di-exec TANPA shell oleh Railway — tidak boleh mengandung `cd`/`&&`/pipe; harus satu perintah polos (`prisma migrate deploy`) |
| `prisma migrate deploy` gagal di pre-deploy | migrasi konflik — cek log deploy; jangan pernah reset di production |
| `/hari-ini` atau halaman lain 500 `sharp module` | binari native sharp tidak ter-trace — sudah diperbaiki (lazy-load + npm install sharp di runner); pakai commit terbaru |
| Upload foto/dokumen error "belum dikonfigurasi" | Env R2 kosong — isi 4 variabel R2 lalu redeploy |
| Tes R2 gagal di menu Sistem | Baca step yang merah: DNS = endpoint salah; Signature = secret salah; NoSuchBucket = nama bucket; AccessDenied = permission token |
