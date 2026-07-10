# OPEN_ISSUES.md

Bug + technical debt + missing pieces yang HARUS dibetulkan sebelum menambah
fitur baru. Update setiap ada temuan baru. Coret (`~~text~~`) kalau sudah fixed.

Priority: 🔴 Critical (blocking) · 🟡 Important · 🟢 Nice-to-have

---

## Schema & Data Model

- 🔴 **Contract 1:1 vs 1:N belum divalidasi ke user**. Sekarang `contracts.locationId @unique` = 1:1. Kalau realita 1 SPK bisa punya banyak lokasi (SPK gabungan), harus refactor → `contract_locations` join table.

- 🔴 **Contractor sebagai string** di `contracts.contractorName`. Perlu tabel `contractors` terpisah supaya 1 kontraktor N kontrak. Migrasi: extract distinct nama, buat records, ganti FK.

- 🟡 **CategoryPhase hardcoded** di `src/lib/scurve.ts`. Setiap ubah phase butuh code deploy. Buat tabel `rab_category_phase_config` (org_id, keyword, phase_start, phase_end) supaya admin bisa edit.

- 🟡 **RAB item dual-parent constraint**. `categoryId` dan `subcategoryId` keduanya nullable. Butuh CHECK constraint: `(categoryId IS NOT NULL) OR (subcategoryId IS NOT NULL) OR (parentItemId IS NOT NULL)`.

- 🟡 **Photo dual-parent constraint**. `dailyReportId` dan `reportItemId` keduanya nullable — bisa orphan. Butuh CHECK constraint minimal satu terisi.

- 🟢 **Province/Regency** sebagai string. Kalau butuh code KKP resmi, buat reference tables `provinces` + `regencies` dari BPS/Kemendagri.

## Security / Auth

- 🔴 **RLS policies belum ditulis**. Schema mention di PROJECT.md, actual SQL migration nol. Semua query bisa akses semua data.

- 🔴 **Audit log middleware belum ada**. Tabel `audit_logs` ada tapi tidak ada mekanisme populate — Prisma middleware belum diset up.

- 🔴 **Append-only enforcement belum ada**. 4 tabel dengan comment `APPEND-ONLY` (daily_reports, contract_amendments, audit_logs, location_status_history) bisa di-UPDATE/DELETE oleh siapa saja yang punya DB access. Butuh:
  ```sql
  CREATE TRIGGER prevent_update_daily_reports
    BEFORE UPDATE ON daily_reports
    FOR EACH ROW EXECUTE FUNCTION raise_immutable();
  ```

- 🟡 **PIN default `123456`** di seed. Aman untuk dev, harus enforce ganti PIN saat first login production.

- 🟡 **Rate limiter belum ada**. Login endpoint rentan brute-force.

- 🟡 **Session storage strategy** — Auth.js default pakai JWT. Perlu decide: JWT (stateless, fast) atau DB session (revocable, bisa force logout).

## API / Data Layer

- 🔴 **BigInt serializer helper belum ada**. Semua endpoint yang return `contracts.contractValue`, `budgetLines.allocated`, dll akan throw error saat `JSON.stringify`. Butuh `src/lib/bigint.ts`:
  ```ts
  export function serializeBigInt<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ));
  }
  ```

- 🟡 **Decimal converter helper** untuk `Prisma.Decimal` → `number` display, dan sebaliknya untuk input.

- 🟡 **Zod schema** untuk semua boundary belum ada. Standar: `src/lib/schemas/*.ts` dengan validators reusable.

## Railway Deployment

- 🔴 **`railway.json` config file** belum ada. Butuh:
  ```json
  {
    "$schema": "https://railway.app/railway.schema.json",
    "build": {
      "builder": "NIXPACKS",
      "buildCommand": "pnpm install && pnpm db:generate && pnpm build"
    },
    "deploy": {
      "startCommand": "pnpm db:migrate:deploy && pnpm start",
      "healthcheckPath": "/api/health",
      "healthcheckTimeout": 300,
      "restartPolicyType": "ON_FAILURE"
    }
  }
  ```

- 🔴 **`/api/health` endpoint** belum ada. Railway health check butuh ini.

- 🔴 **Postgres extensions** (`postgis`, `pgcrypto`) perlu enable manual di Railway Postgres via:
  ```sql
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  ```
  Bisa di-migrasi jadi migration file pertama.

- 🟡 **Redis service** belum di package.json. Butuh `ioredis` untuk BullMQ + session cache.

- 🟡 **Worker service** untuk BullMQ background jobs belum ada. Photo processing (thumbnail, EXIF stamp) butuh worker. Railway support multi-service deploy.

- 🟡 **Cron scheduler** untuk weekly report Sabtu 23:00. Pilihan: Railway Cron (managed) atau `node-cron` di worker service.

- 🟢 **Build cache** — Prisma Client generation cache-nya bisa dihemat via `PRISMA_CLI_QUERY_ENGINE_TYPE=binary` + volume.

- 🟢 **Log aggregation ke Sentry** — Railway punya native logging tapi Sentry lebih baik untuk error tracking.

## UI / Pages

- 🔴 **Auth pages belum ada** — login, PIN entry, device confirmation, PIN reset flow

- 🔴 **Middleware belum ada** untuk route protection based on role

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

## Untuk User (Hery) Perlu Konfirmasi

- Format resmi laporan mingguan/bulanan KKP — upload sample kalau ada
- Struktur SPK: 1 kontrak = 1 lokasi atau 1:N?
- Retention policy foto (5 tahun? 10 tahun?)
- Backup strategy: Railway daily backup cukup, atau perlu extra offsite?
- Monitoring stack: Sentry + Umami cukup, atau perlu Grafana Cloud?
