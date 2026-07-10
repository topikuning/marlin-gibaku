# KNMP Monitor

**Sistem monitoring & pelaporan proyek Kampung Nelayan Merah Putih**
untuk 83 lokasi di 7 provinsi.

Setiap keputusan design/arsitektur di-log di sini. Ini adalah **single source of truth**.
Kalau ada konflik antara kode dan dokumen ini, ini yang menang — kode yang diubah.

---

## 1. Konteks & Tujuan

Program KNMP (Kampung Nelayan Merah Putih) dari Kementerian Kelautan dan
Perikanan Republik Indonesia. Membangun infrastruktur kampung nelayan
(revetment, shelter pendaratan ikan, gudang beku, kios, dsb) di 83 lokasi
pesisir di Jateng, Jatim, DIY, Jabar, Banten, Lampung, Bengkulu.

**Masalah yang dipecahkan**:
1. Progress lapangan tidak tercatat sistematis — email/WA/kertas
2. Site Manager (SM) di lokasi terpencil dengan tingkat literasi digital rendah
3. Laporan ganda ke internal (perusahaan) + eksternal (KKP) — waste
4. Bukti foto tersebar di HP individu, tidak searchable
5. Executive tidak punya visibility real-time 83 lokasi

**Tujuan sistem**:
- Field workers lapor progress dengan minimal friction
- Data sekali input, generate semua laporan (internal + KKP)
- Executive dashboard real-time
- Photo archive terstruktur, GPS/EXIF-validated

---

## 2. User & Peran

Enam tingkat role, enforced via Postgres Row-Level Security:

| Role | Scope | Login |
|---|---|---|
| `super_admin` | Semua lokasi, semua data | Web app |
| `program_director` | Semua lokasi (read + export) | Web app |
| `regional_manager` | 1 provinsi (5-15 lokasi) | Web app |
| `project_manager` | N lokasi per kontraktor (2-10) | Web app |
| `site_manager` | 1 lokasi | Mobile PWA |
| `exec_viewer` | Dashboard read-only (untuk KKP) | Web app |

**Field supervisor (mandor)** = _bukan role login_. Cuma nomor HP terdaftar.
Draft masuk atas nama mereka via WA text (dengan format template),
di-approve oleh Site Manager. Zero training/onboarding untuk mandor.

---

## 3. Stack Teknologi (Locked)

| Layer | Pilihan | Alasan |
|---|---|---|
| Framework | **Next.js 15** (App Router) | Full-stack, mobile PWA + desktop dari 1 codebase |
| Runtime | Node.js 22 LTS | Sama seperti proyek existing user |
| Language | TypeScript strict | Type safety end-to-end |
| Database | **PostgreSQL 17** (Railway managed) | RLS native, JSONB, mature |
| ORM | Prisma 6 | Type-safe queries, migration system |
| Auth | Auth.js v5 (Credentials Provider) | Phone + PIN + device binding |
| Storage | Cloudflare R2 | S3-compatible, free egress, $0.015/GB |
| Cache/Queue | Redis 7 (Railway) | Session cache + BullMQ jobs |
| UI | Tailwind 4 + shadcn/ui | Konsisten, mobile-first |
| Charts | Recharts | S-curve + dashboards |
| Forms | react-hook-form + zod | Validasi type-safe |
| Data fetching | TanStack Query (client) + Server Actions | Optimistic UI + streaming |
| PDF export | @react-pdf/renderer (server-side) | Untuk laporan KKP |
| XLSX export | ExcelJS | Untuk Back-up Data KKP |
| Deploy | Railway (4 services: web, worker, postgres, redis) | Single-vendor, murah |

**Yang eksplisit NOT dipilih**:
- Supabase (kita pakai Railway Postgres + Auth.js custom instead)
- Vercel (Railway lebih cocok untuk long-running workers + Indonesian latency)
- Firebase (vendor lock-in)
- MongoDB (butuh JOINs + RLS)

---

## 4. Arsitektur Data (21+ Tabel)

Data model lengkap ada di [`prisma/schema.prisma`](./prisma/schema.prisma).
Ringkasan grup:

### 4.1 Identitas & Akses (5 tabel)
`organizations`, `users`, `devices`, `user_location_assignments`, `otp_codes`

### 4.2 Struktur Proyek (7 tabel)
`contracts`, `contract_amendments`, `locations`, `rab_categories`,
`rab_subcategories`, `rab_items`, `location_status_history`

### 4.3 Pelaporan & Bukti (7 tabel)
`daily_reports`, `daily_report_items`, `photos`, `cost_entries`,
`weekly_plans`, `weekly_plan_items`, `weekly_reports`, `monthly_reports`

### 4.4 Sistem & Audit (3 tabel)
`alerts`, `audit_logs`, `sync_queue`

### 4.5 Keputusan Data Model Kritis

**A. Kontrak vs Lokasi = 1:1** (bisa refactor ke 1:N nanti)
Dari inspeksi 7 HPS Kedungmutih, Purworejo, dll — 1 file HPS = 1 lokasi.
Assumption: 1 SPK = 1 lokasi. Kalau nanti ternyata ada SPK gabungan,
`contracts.location_id` → `contract_locations` join table.

**B. Progress = volume-based, bukan slider %**
Site Manager lapor **volume selesai** dalam satuan asli (m², m³, kg, bh).
Progress % adalah _derived_: `SUM(item_realized_value) / SUM(item_total_value)`.
Alasan: KKP butuh volume terpasang untuk BAP & termin. Slider % adalah
double conversion yang error-prone.

**C. Sub-item WAJIB granular**
1 line item RAB bisa punya 10+ sub-item (6.1, 6.1.a, 6.1.b, dsb).
SM harus lapor per sub-item. Data lebih kaya, konsisten dengan format KKP.

**D. Semua laporan `append-only`**
`daily_reports`, `contract_amendments`, `audit_logs`, `location_status_history`
tidak boleh UPDATE atau DELETE. Koreksi = row baru dengan `supersedes_id`
menunjuk ke original. Untuk audit KKP.

**E. Foto disimpan di Cloudflare R2, metadata di Postgres**
`photos.r2_key` = path di R2 bucket. `photos.sha256` unique untuk deteksi
foto reused. `photos.exif_gps_lat/lng` + `photos.exif_taken_at` untuk
anti-tampering.

**F. Multi-tenant ready, single-tenant runtime**
Semua tabel punya `organization_id` (default 1). Kalau nanti jadi SaaS,
tinggal enable multi-tenant filter di RLS.

**G. Weekly Plan `advisory`, tidak locking**
`weekly_plan_items` = target SM untuk minggu ini. Kalau SM lapor item di
luar plan, field `daily_report_items.was_outside_plan = true`. Cuma flag,
tidak block submit. Progress tetap dihitung ke total.

**H. Grand total = SUM dari kategori aktif RAB**
Untuk Kedungmutih: Rp 3.06M (bukan Rp 3.13M dari Resume sheet HPS).
Alasan: konsistensi dengan cara hitung realisasi. Resume sheet KKP kadang
punya kategori "0" yang di-sum tapi tidak aktif.

---

## 5. Alur Pelaporan Harian (User Journey)

```
06:00  Sistem generate suggested plan minggu ini dari kurva-S (Senin only)
07:00  PM review + submit weekly plan → Notif WA ke SM
07:30  SM buka app: lihat 14 target items minggu ini
08:00  Mandor kerja lapangan sepanjang hari
       Kirim WA text ke SM dengan format template:
       "II.4.d | 3.2 m3 | cor kolom L2 utara | [4 foto]"
19:00  SM buka app malam hari
       Lihat 14 draft dari 4 mandor (kalau lengkap)
       Review satu-per-satu di layar Item Detail:
         - Volume input dari mandor (edit kalau salah)
         - Foto (verify GPS + EXIF)
         - Catatan
       Batch approve 8 items yang ready
       Tap "Kirim" → 8 items masuk sistem
20:00  Sistem trigger side-effects:
         - Update dashboard PM & Regional (real-time)
         - Notif WA ke PM & Konsultan Pengawas
         - Append row ke Back-up Data KKP
         - Kalau Sabtu → generate laporan mingguan
23:00  (Sabtu) Cron generate laporan mingguan otomatis
         - Compare actual vs weekly plan
         - Highlight items yang deviasi
         - PDF signed ke KKP portal
```

---

## 6. Kurva-S Auto-Generation

Algoritma di [`src/lib/scurve.ts`](./src/lib/scurve.ts) (port dari Python).

**Input**: RAB (parsed dari HPS Excel) + durasi kontrak (hari)
**Output**: 22 nilai weekly cumulative % + per-kategori timeline + per-item weekly volume

**Metode**:
1. Setiap kategori RAB di-map ke `phase window` (start%, end% dari durasi)
   berdasarkan urutan konstruksi standar KNMP (Persiapan front-loaded,
   Landskaping back-loaded).
2. Dalam phase window, distribusi bobot pakai cubic smoothstep
   `f(t) = 3t² - 2t³` untuk S-shape (slow start, fast middle, slow finish).
3. Sum semua kategori per minggu = weekly delta cumulative.
4. Per-item: alokasi volume mingguan proporsional dengan phase kategorinya.

**Lookup table category → phase** ada di file yang sama. 34 kata kunci
cover semua kategori HPS KNMP.

**Weakness known**:
- Baseline algoritma, belum divalidasi dengan data historis
- Tidak consider dependencies (bekesting sebelum cor)
- Tidak consider musim hujan
- Uniform working days (no libur nasional)

**Path ke v2**: kumpulkan data lokasi selesai → learn optimal phase per
kategori → refactor lookup table.

---

## 7. Foto Pipeline

**Client (browser HP)**:
1. Native camera via `<input type="file" accept="image/*" capture="environment">`
2. Compress client-side ke max 1920px, JPEG quality 80% pakai canvas API
3. Simpan di IndexedDB kalau offline (sync later)
4. Kalau online: request presigned URL, PUT direct ke R2

**Server**:
1. Endpoint `POST /api/photos/presign` → return signed PUT URL (valid 15 menit)
2. Endpoint `POST /api/reports/[id]/photos` → validate metadata
3. Validation rules:
   - `EXIF GPS` wajib ada → tanpa ini reject
   - `EXIF taken_at` ≤ 24 jam lampau → di luar itu reject
   - GPS dalam `location.geofence_radius_m` → di luar itu FLAG (bukan reject)
   - `SHA256` sudah pernah muncul → FLAG duplicate
4. Background job (BullMQ):
   - Generate thumbnail 400px
   - Add overlay stamp (lokasi + timestamp + GPS)
   - Update `photos.verification` enum

**Cost estimasi (100 lokasi × 10 foto/hari × 300 hari = 300k foto)**:
- Storage: 300k × 250KB = 75 GB × $0.015 = **$1.13/bulan**
- Class A operations (PUT): 300k × $4.50/million = **$1.35/bulan**
- Egress: **$0** (R2 free)
- Total setahun: ~$30

---

## 8. Auth Flow

**Phone + PIN + device binding**, admin-provisioned.

**First login** (device baru):
1. Admin bikin user via UI: `phone_e164` + PIN awal 6 digit
2. User buka app, input phone + PIN
3. Server generate OTP → kirim via WAHA bot ke WA user
4. User input OTP → device fingerprint didaftarkan
5. Force ganti PIN

**Return login** (same device):
1. Cookie kenali device
2. Input PIN saja
3. Rate limit 10 attempt / 15 menit
4. Session 30 hari (sliding)

**Session duration per role** (locked):
- `site_manager`: 30 hari (sering pakai, HP jarang dipinjam)
- `project_manager`, `regional_manager`: 7 hari
- `super_admin`, `program_director`, `exec_viewer`: 24 jam

**PIN hashing**: Argon2id (bukan bcrypt — Argon2 lebih tahan GPU attacks).

**Rate limit**: pakai Redis + sliding window. Semua endpoint mutation.

**Post-scaffold TODO**:
- WA OTP via WAHA (skip dulu di scaffold, hardcode "OTP always accepted")
- Admin panel untuk provisioning bulk user via CSV

---

## 9. Roll-out Strategy

**83 lokasi day 1**. Bukan pilot bertahap.

Konsekuensi:
- User provisioning perlu bulk import CSV dari hari 1
- Testing perlu covering RLS di scale (query dengan 400+ user)
- Backup + restore strategy dari hari 1 (Railway automated backup + manual snapshot)
- Monitoring wajib (Sentry untuk error, Umami untuk usage)

---

## 10. Roadmap Coding

**v0 · Scaffold** (session ini)
- [x] PROJECT.md
- [x] Prisma schema lengkap
- [x] package.json + config files
- [x] HPS parser (Python) + seed data 7 lokasi
- [ ] Migrasi DB pertama
- [ ] Auth setup (skeleton)

**v0.1 · Auth + Basic Layout** (session 2)
- Login page (phone + PIN)
- Home page skeleton per role
- Middleware untuk role-based routing
- Session management

**v0.2 · SM Core Flow** (session 3-4)
- RAB tree view per lokasi
- Submit report: pilih item → volume → foto (mock upload dulu)
- Draft state management
- Item detail modal dengan history

**v0.3 · R2 Photo Upload** (session 5)
- Presigned URL endpoint
- Client-side compression
- EXIF validation server-side
- Photo grid per item

**v0.4 · PM Dashboard** (session 6-7)
- Kurva-S chart dengan real data
- Weekly plan editor
- Item schedule dari algoritma S-curve
- Rollup per lokasi

**v0.5 · Exec Dashboard** (session 8)
- Multi-lokasi overview
- Provinces breakdown
- Alerts feed
- Photo wall

**v0.6 · Export** (session 9)
- Excel Back-up Data KKP
- PDF Kurva-S
- Weekly report auto-generate

**v0.7 · Deploy** (session 10)
- Railway setup
- Environment variables
- Postgres + Redis provisioning
- Smoke test end-to-end

**v0.8+ · Post-MVP** (paralel)
- WAHA integration untuk OTP + mandor draft
- Offline mode + Service Worker
- Deviasi tracking UI
- Reforecast algorithm
- Import HPS baru via UI
- Multi-tenant enable
- Custom reports

---

## 11. Yang DIPUTUSKAN DROP

- **Voice-note dari mandor**: tidak efektif di lapangan. Zero net time saved,
  bahkan negatif kalau STT + LLM salah interpret volume/item.
- **Multi-user per lokasi (mandor login sendiri)**: 400+ user gaptek =
  training + support beban terlalu besar. Cukup SM sebagai single point of
  accountability, mandor via WA.
- **Wizard multi-step untuk submit**: single-screen dengan section jelas
  lebih baik.
- **Progress input via slider %**: tidak sesuai kebutuhan KKP.

---

## 12. Yang MASIH DIRAGUKAN (perlu keputusan di session mendatang)

1. Format template resmi KKP untuk laporan mingguan/bulanan — kalau kamu
   punya sample, upload. Sekarang saya generate best-guess mirroring HPS.
2. Struktur folder foto di R2:
   - Opsi A: `photos/{location}/{report_date}/{photo_id}.jpg`
   - Opsi B: `photos/{location}/{item_code}/{report_date}/{photo_id}.jpg`
   - Rekomendasi: **A** karena flat + item_id ada di metadata.
3. Retention policy foto: berapa lama disimpan? Untuk audit KKP biasanya 5-10
   tahun. Storage cost naik tapi tidak dramatic.
4. Backup strategy: Railway daily backup default. Perlu extra offsite backup
   (mis. weekly ke S3)?
5. Monitoring/observability stack: Sentry (errors) + Umami (usage) cukup, atau
   perlu Grafana Cloud + Loki juga?

---

## 13. Development Standards

**Language**: Bahasa Indonesia untuk UI text, English untuk kode identifier,
comments, git commit messages.

**Commit convention**: Conventional Commits
- `feat: tambah submit report flow`
- `fix: geofence validation off-by-one`
- `refactor: split auth into separate service`

**Branch strategy**: `main` = production. Feature branches: `feature/{scope}`.

**Testing**:
- Unit: Vitest (untuk lib functions, RAB parser, S-curve algo)
- Integration: Playwright (untuk critical flows)
- Load: k6 (untuk RLS + concurrent submits) sebelum go-live

**Code style**: Prettier + ESLint (Next.js default). No debate.

**Types**: Zod schemas untuk semua input/output boundary (API + forms).

---

## 14. Dependencies (See package.json)

Locked ke major version. Update audit sebulan sekali.

---

## 15. Contacts

- Program Director: _(diisi user)_
- Repo: _(diisi user)_
- Deployment: Railway → _(diisi user)_
- Domain: _(diisi user)_
