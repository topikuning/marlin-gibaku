# OPEN_ISSUES.md

Bug + technical debt + missing pieces yang HARUS dibetulkan sebelum menambah
fitur baru. Update setiap ada temuan baru. Coret (`~~text~~`) kalau sudah fixed.

Priority: 🔴 Critical (blocking) · 🟡 Important · 🟢 Nice-to-have

---

## Schema & Data Model

- ~~🔴 **Contract 1:1 vs 1:N belum divalidasi ke user**~~. **RESOLVED** (DECISIONS 016): user konfirmasi 1:N. `locations.contract_id` tanpa `@unique` (FK, bukan join table).

- ~~🔴 **Contractor sebagai string**~~. **RESOLVED** (DECISIONS 017): tabel `contractors` + `contracts.contractor_id` FK. Seed extract distinct.

- 🟡 **CategoryPhase hardcoded** di `src/lib/scurve.ts`. Setiap ubah phase butuh code deploy. Buat tabel `rab_category_phase_config` (org_id, keyword, phase_start, phase_end) supaya admin bisa edit.

- ~~🟡 **RAB item dual-parent constraint**~~. **RESOLVED**: CHECK `rab_items_parent_present` di init migration. Plus relasi self `onDelete: Cascade` (DECISIONS 022).

- ~~🟡 **Photo dual-parent constraint**~~. **RESOLVED**: CHECK `photos_parent_present` di init migration.

- 🟢 **Province/Regency** sebagai string. Kalau butuh code KKP resmi, buat reference tables `provinces` + `regencies` dari BPS/Kemendagri.

## Security / Auth

- 🔴 **RLS policies belum ditulis**. Schema mention di PROJECT.md, actual SQL migration nol. Semua query bisa akses semua data.

- 🔴 **Audit log middleware belum ada**. Tabel `audit_logs` ada tapi tidak ada mekanisme populate — Prisma middleware belum diset up.

- ~~🔴 **Append-only enforcement belum ada**~~. **RESOLVED**: fungsi `raise_immutable()` + 4 trigger `BEFORE UPDATE OR DELETE` (daily_reports, contract_amendments, audit_logs, location_status_history) di init migration. Terverifikasi memblokir UPDATE/DELETE.

- 🟡 **Password default `password123`** di seed. Aman untuk dev, harus enforce ganti password saat first login production. (dulu PIN 123456)

- 🔴 **Rate limiter belum ada**. Login endpoint rentan brute-force. Naik ke Critical karena auth sekarang cuma password (tanpa OTP/device binding, DECISIONS 019) — brute-force jadi satu-satunya barrier.

- ~~🟡 **Session storage strategy**~~. **RESOLVED** (DECISIONS 021): JWT stateless, durasi per-role via `absExp`.

- 🟡 **Force-logout / revocation belum ada**. JWT stateless → tidak bisa force-logout (mis. setelah ganti password / user di-nonaktifkan, token lama masih valid sampai `absExp`). Butuh DB session atau token-version di `users`.

## API / Data Layer

- ~~🔴 **BigInt serializer helper belum ada**~~. **RESOLVED**: `src/lib/bigint.ts` → `serializeBigInt()`.

- 🟡 **Decimal converter helper** untuk `Prisma.Decimal` → `number` display, dan sebaliknya untuk input.

- 🟡 **Zod schema** untuk semua boundary. **Sebagian**: `src/lib/schemas/auth.ts` (login) dibuat. Boundary lain (report submit, contract, dll) belum.

## Railway Deployment

- ~~🔴 **`railway.json` config file** belum ada~~. **RESOLVED**: `railway.json` dibuat (build + start + healthcheck `/api/health`).

- ~~🔴 **`/api/health` endpoint** belum ada~~. **RESOLVED**: `src/app/api/health/route.ts` (cek `SELECT 1`, 200/503).

- ~~🔴 **Postgres extensions**~~. **RESOLVED/REVISI** (DECISIONS 020): postgis di-drop (unused), `pgcrypto` di-`CREATE EXTENSION` di init migration.

- 🟡 **Redis service** belum di package.json. Butuh `ioredis` untuk BullMQ + session cache.

- 🟡 **Worker service** untuk BullMQ background jobs belum ada. Photo processing (thumbnail, EXIF stamp) butuh worker. Railway support multi-service deploy.

- 🟡 **Cron scheduler** untuk weekly report Sabtu 23:00. Pilihan: Railway Cron (managed) atau `node-cron` di worker service.

- 🟢 **Build cache** — Prisma Client generation cache-nya bisa dihemat via `PRISMA_CLI_QUERY_ENGINE_TYPE=binary` + volume.

- 🟢 **Log aggregation ke Sentry** — Railway punya native logging tapi Sentry lebih baik untuk error tracking.

## UI / Pages

- ~~🔴 **Auth pages belum ada**~~. **RESOLVED (sebagian)**: login page `/masuk` (username/email + password). Device/OTP/reset flow di-drop (DECISIONS 019). Password-reset UI masih TODO.

- ~~🔴 **Middleware belum ada**~~. **RESOLVED**: `src/middleware.ts` (protect route, redirect ke /masuk). Catatan: sekarang cek login saja, **belum** role-based authorization per-route (mis. /admin/* cuma super_admin) — itu TODO v0.2.

- 🔴 **Master data pages** — daftar lengkap di PROJECT.md section 4 belum ada semua

- 🟡 **Error boundary + 404/500 pages** belum ada

- 🟡 **PWA manifest + service worker** belum ada (untuk installable mobile)

- 🟢 **i18n framework** kalau nanti multi-provinsi butuh dialek (mis. bahasa Madura di Bangkalan)

## Testing

- 🔴 **Belum ada test satupun**. Priority:
  - Unit: S-curve algorithm (deterministic, mudah test)
  - Unit: HPS parser edge cases
  - Integration: RLS policy enforcement
  - E2E: submit report end-to-end

## Documentation

- 🟡 **PROJECT.md section 15 Contacts** masih placeholder `(diisi user)`

- 🟡 **API documentation** — pakai OpenAPI/Swagger? atau tRPC yang self-documenting?

- 🟢 **Runbook** untuk incident (DB down, R2 down, WAHA bot down)

## Ditemukan Sesi 3 (2026-07-10, Claude Code)

- 🟡 **Parser HPS hasilkan kode subkategori duplikat** dalam 1 kategori. Contoh `batah-timur.json`: kategori VIII punya `VIII.1` dua kali; kategori IX bahkan berisi subcode `XIII.1`, `XIII.2` (dobel) — jelas artefak misalignment parsing. Melanggar `@@unique([categoryId, code])`. **Workaround** di seed: disambiguasi jadi `<code>#2`. **Fix asli** harus di `scripts/generate_seed.py` (parser). Selama belum, kode subkategori di DB untuk lokasi terdampak tidak akurat 1:1 dengan HPS.

- 🟢 **Session cookie maxAge global 30 hari**. Per-role expiry di-enforce via `absExp` di JWT (benar), tapi cookie lifetime tidak dipersingkat per-role. Konsekuensi minor; enforcement tetap jalan.

- 🟡 **`.gitignore` hilang** dari scaffold (SESSION_LOG klaim ada, faktanya tidak). **FIXED**: dibuat.

- 🟡 **ESLint belum dikonfigurasi** (deps ada, config file nol → `next lint` interaktif/gagal di CI). **FIXED**: `eslint.config.mjs` (flat config), script `lint` → `eslint .`, tambah `@eslint/eslintrc`.

- 🔴 **Belum ada test otomatis satupun** (masih). Auth flow sesi ini diverifikasi manual end-to-end (curl + real Postgres), tapi belum ada Vitest/Playwright. Prioritas berikut: unit S-curve, integration login, e2e submit report.

## Untuk User (Hery) Perlu Konfirmasi

- Format resmi laporan mingguan/bulanan KKP — upload sample kalau ada
- ~~Struktur SPK: 1 kontrak = 1 lokasi atau 1:N?~~ **Terjawab: 1:N** (DECISIONS 016)
- Flow mandor (DECISIONS 018): mandor submit report langsung, atau tetap SM yang approve item dari mandor? (blocker v0.2 SM/mandor core flow)
- Retention policy foto (5 tahun? 10 tahun?)
- Backup strategy: Railway daily backup cukup, atau perlu extra offsite?
- Monitoring stack: Sentry + Umami cukup, atau perlu Grafana Cloud?
