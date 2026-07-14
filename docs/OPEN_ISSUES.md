# OPEN_ISSUES.md

Bug + technical debt + missing pieces. Ditulis ulang saat rebuild total 2026-07-14
(isu lama pra-rebuild ada di git history — mayoritas selesai by design di rebuild:
audit log kini ditulis tiap mutasi, rate limit login ada, session revocable,
anti-double-input jadi constraint DB, keuangan transaksional, zod di boundary baru).

Priority: 🔴 Critical (blocking production) · 🟡 Important · 🟢 Nice-to-have

---

## Data

- 🔴 **Kualitas data seed JSON (parser python lama)**: `total_value` kategori korup di
  seed-data/*.json — roman ganda berbagi nilai (IX/IX#2), kategori XI–XIII hilang
  (item tergabung ke kategori sebelumnya), beberapa kategori 0. Rebuild memakai basis
  konsisten Σ leaf (`flattenParsedRab`), tapi pembagian kategori tetap mengikuti JSON
  korup. FIX SEBENARNYA: minta file HPS xlsx asli → re-import via UI import RAB
  (parser TS baru), atau perbaiki `scripts/parse_hps.py` + regenerate.
- 🟡 **CategoryPhase/TRADES hardcoded** di `src/lib/scurve/generate.ts` (keyword→window).
  Kandidat: tabel konfigurasi effective-dated.
- 🟢 Province/Regency masih string bebas (belum reference table BPS).

## Security

- 🟡 **RLS belum diimplementasi** (dan TIDAK diklaim). Otorisasi di application layer
  (capability + scope), diuji test. RLS = hardening tahap berikut.
- 🟡 Rate limit hanya untuk login; server action lain belum di-rate-limit.
- 🟢 CSP/security headers belum diset di next.config.

## Fitur ditunda sadar (lihat docs/rebuild/REBUILD_PLAN.md)

- 🟡 **Peta lokasi** (Leaflet) — fitur lama berfungsi, belum diport ke rebuild.
- 🟡 **PWA offline penuh** — sekarang: draft lokal (localStorage) + submit idempotent;
  belum ada service worker/manifest installable/background sync.
- 🟢 PR/PO/receiving granular (kini direpresentasikan Commitment+Expense).
- 🟢 Intake WA-text mandor (model lama SuggestionSource tidak dibawa).
- 🟢 Cash forecast otomatis dari baseline (fungsi `cashRequirement` ada; UI input
  forecast biaya belum).

## Teknis

- 🟡 **ESLint ditahan 9.39.5** — eslint-config-next 16 (eslint-plugin-react) belum
  kompatibel ESLint 10. Re-evaluasi tiap rilis Next.
- 🟡 **TypeScript ditahan 5.9.3** — TS 7 (native) belum diverifikasi dengan plugin Next.
- 🟡 `pnpm audit`: 3 moderate di transitive dev deps (tidak high/critical; CI gate high).
- 🟢 `exceljs` maintenance lambat; buffers@0.1.1 transitive tanpa metadata lisensi
  (pengecualian terdokumentasi di OPEN_SOURCE_LICENSE_AUDIT.md).
- 🟢 Foto stamp memakai font DejaVu bundel; verifikasi otomatis foto (flag GPS/waktu)
  belum dievaluasi rutin (dedup sha256 jalan).
