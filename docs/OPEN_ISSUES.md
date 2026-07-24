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

- 🟡 **PWA offline penuh** — sekarang: draft lokal (localStorage) + submit idempotent;
  belum ada service worker/manifest installable/background sync.
- 🟢 PR/PO/receiving granular (kini direpresentasikan Commitment+Expense).
- 🟢 Intake WA-text mandor (model lama SuggestionSource tidak dibawa).
- 🟢 Cash forecast otomatis dari baseline (fungsi `cashRequirement` ada; UI input
  forecast biaya belum).
- 🔵 **FUTURE — parse PDF undangan/penunjukan → buat prospek otomatis.** Surat KKP
  (mis. "Undangan Penunjukan Langsung") teks-asli memuat: nama paket, HPS total +
  rincian per-desa (= lokasi), vendor, provinsi, nomor/tanggal surat, target TTD
  kontrak. Alur: upload PDF → ekstrak teks → PRATINJAU (editable, kabupaten per-desa
  WAJIB dikoreksi manusia karena surat tak mengikat desa↔kab) → buat prospek + lokasi
  target. Rekomendasi: parser deterministik (regex, tanpa AI runtime — privasi dokumen
  pemerintah); LLM opsional bila format bervariasi. Belum tersedia kolom HPS per-lokasi.
  Tak mencakup PDF hasil scan (perlu OCR). Ditunda atas permintaan user (2026-07-24).

## Teknis

- 🟡 **ESLint ditahan 9.39.5** — eslint-config-next 16 (eslint-plugin-react) belum
  kompatibel ESLint 10. Re-evaluasi tiap rilis Next.
- 🟡 **TypeScript ditahan 5.9.3** — TS 7 (native) belum diverifikasi dengan plugin Next.
- 🟡 `pnpm audit`: 3 moderate di transitive dev deps (tidak high/critical; CI gate high).
- 🟢 `exceljs` maintenance lambat; buffers@0.1.1 transitive tanpa metadata lisensi
  (pengecualian terdokumentasi di OPEN_SOURCE_LICENSE_AUDIT.md).
- 🟢 Foto stamp memakai font DejaVu bundel; verifikasi otomatis foto (flag GPS/waktu)
  belum dievaluasi rutin (dedup sha256 jalan).

## FUTURE · Serah terima parsial (PHO parsial per pekerjaan) — DECISIONS 078
Kontrak KNMP membolehkan PHO PARSIAL atas pekerjaan yang sudah 100% (mis. revetmen)
sebelum PHO final atas seluruh lokasi. Saat ini milestone PHO/FHO = induk tunggal.
Perlu: model serah terima parsial (per pekerjaan/kategori/lokasi selesai) + BA-nya,
tanpa mengganggu PHO/FHO final.

## FUTURE · Auto-flag termin berdasar progres agregat — DECISIONS 078
Termin 20/25/30/25 ditagih saat progres TOTAL kontrak mencapai 25/50/80/100%, dengan
retensi pemeliharaan 5% (bisa diganti jaminan pemeliharaan). Perlu: modul keuangan
otomatis menandai "termin-N siap ditagih" saat progres agregat lewat ambang, +
perhitungan retensi & opsi jaminan pemeliharaan. Milestone pembayaran sudah scope induk.
