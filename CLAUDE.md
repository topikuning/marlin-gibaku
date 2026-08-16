# CLAUDE.md

Instruksi untuk Claude Code saat bekerja di repo ini.

**Baca file ini dulu**, lalu:
1. [`PROJECT.md`](./PROJECT.md) — arsitektur, domain model, **formula angka kanonik** (single source of truth)
2. [`docs/OPEN_ISSUES.md`](./docs/OPEN_ISSUES.md) — bug + TODO sebelum fitur baru
3. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — decision log append-only (051 = rebuild total)
4. [`docs/README.md`](./docs/README.md) — peta seluruh dokumentasi (mana yang hidup, mana yang arsip)

**Menyentuh progress / deviasi / kurva-S / laporan / uang?** Baca
[`docs/rebuild/CALCULATION_INTEGRITY_PROTOCOL.md`](./docs/rebuild/CALCULATION_INTEGRITY_PROTOCOL.md)
lebih dulu — protokol itu wajib, bukan anjuran.

---

## Konteks Cepat

- **Sistem**: MARLIN — pengendalian proyek Kampung Nelayan Merah Putih (KNMP)
- **Skala**: 83 lokasi, 7 provinsi; arsitektur menargetkan 200+
- **User utama**: Site Manager & Mandor lapangan (umumnya gaptek) + manajemen
- **Alur inti**: Paket (prospek→tender→kontrak→pelaksanaan→serah terima) → Lokasi →
  RAB (revisi + lineage) → Baseline kurva-S → Laporan Harian terpadu
  (draft→dikirim→perlu_koreksi→disetujui→final) → Progress → Keuangan transaksional →
  Laporan KKP
- **State**: hasil rebuild total 2026-07-14 (DECISIONS 051). Belum production.

## Prinsip WAJIB

1. **Bahasa Indonesia untuk UI text, English untuk identifier kode** (enum status domain = Indonesia).
2. **PROJECT.md single source of truth** — konflik kode vs PROJECT.md ⇒ kode salah.
   Ubah keputusan ⇒ tanya user ⇒ append `docs/DECISIONS.md`.
3. **Setiap mutasi server action**: `requireCapability()` (+ `requireLocationAccess`
   bila menyangkut lokasi) + `audit()`. Frontend hanya menyembunyikan menu.
4. **Angka agregat selalu derived** — jangan pernah bikin kolom agregat yang diedit manual.
5. **Status hanya berubah lewat mesin transisi** `src/lib/lifecycle.ts` + tulis histori.
6. Bug baru → `docs/OPEN_ISSUES.md` (yang SELESAI dihapus dari sana, bukan
   dicoret); keputusan baru → append `docs/DECISIONS.md`.
7. **Formula angka hanya boleh ditulis di `src/lib/progress-calc.ts` +
   `src/lib/progress.ts` + `src/lib/finance/calc.ts` +
   `src/lib/ahsp/rapl-calc.ts` (kebutuhan RAPL, DECISIONS 320).** Komponen,
   PDF, Excel, dan prompt AI dilarang menghitung ulang.

## Commands

```bash
pnpm dev                 # dev server
pnpm typecheck           # WAJIB sebelum commit
pnpm lint
pnpm vitest run tests/unit
DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
  pnpm vitest run tests/integration    # butuh migrate deploy dulu ke DB test
pnpm build               # prisma generate + next build (standalone)
pnpm test:e2e            # Playwright (butuh server + seed)

pnpm db:generate         # regenerate Prisma Client (Prisma 7 → src/generated/prisma)
pnpm db:migrate          # migration dev
pnpm db:seed             # seed dev (idempotent; password semua user: marlin123)
pnpm db:reset            # guarded (tolak production / DB non-dev)
pnpm docs:permission     # regenerate docs/rebuild/PERMISSION_MATRIX.md dari authz.ts

docker build --no-cache -t marlin:test .   # verifikasi deploy
```

## Stack (pinned exact — lihat docs/rebuild/TECHNOLOGY_AUDIT.md)

Node 24 LTS · pnpm 11 (corepack) · Next 16 App Router · React 19 · TS 5.9 ·
Prisma 7 + @prisma/adapter-pg (client di `src/generated/prisma`) · PostgreSQL 16+ ·
Tailwind 4 · Zod 4 · AG Grid Community 36 (DILARANG Enterprise) · auth custom
session-DB (BUKAN next-auth) · R2 via aws-sdk · sharp · exceljs.
Deploy: Railway + Dockerfile (DILARANG Nixpacks/Railpack).

## Struktur

```
src/
├── app/(auth)/masuk, ganti-password
├── app/(app)/           # semua butuh sesi: / (command center), paket/, lokasi/,
│                        # hari-ini/, foto-cepat/, foto/, progress/, keuangan/,
│                        # dokumen/, laporan/, pengguna/, sistem/
├── app/cetak/           # print A4 tanpa shell
├── app/api/health, ready, documents/[id]
├── lib/                 # db, env (validasi+normalisasi R2), authz (capability),
│   ├── auth/            # session (DB, revocable), password, actions, page-guard
│   ├── rab/             # parsed, hps-parser, flatten, import
│   ├── scurve/          # generate (kurva-S evaluasi kontinu, DECISIONS 052 — jaga properti: mulai 0, akhir 100, monoton, bentuk-S)
│   │                    # jadwal-verbatim (impor Excel dipakai APA ADANYA, DECISIONS 203)
│   ├── daily-report/    # actions + queries workflow laporan
│   ├── foto-cepat/      # jepret dulu, item belakangan (DECISIONS 253) — foto
│   │                    # tanpa induk + cap dasar, TANPA cadangan titik proyek
│   ├── finance/         # calc (SATU-satunya tempat formula agregat) + actions
│   ├── milestones/      # template 45 item KKP + actions
│   ├── progress.ts      # SATU calculation layer progress
│   └── lifecycle.ts     # mesin transisi status + label + tone
├── components/ui/       # primitives (token-based, tanpa hex)
├── components/shell/    # AppShell, nav (filter by capability)
├── components/grid/     # MarlinGrid (AG Grid Community wrapper)
└── components/knmp/     # domain: scurve-chart, kkp-*-report, photo-gallery
```

## Aturan Coding

- Uang: `BigInt` rupiah; serialisasi ke client via `bigintToString`. PPN dari
  `Contract.ppnPercent` (RAB pre-PPN, kontrak incl-PPN) — jangan hardcode.
- Volume: `Decimal(15,3)`. Datetime: `Timestamptz`; logika harian pakai
  `jakartaDateKey/jakartaToday` (Asia/Jakarta); kolom tanggal kerja = `@db.Date`.
- **Foto: berkas ASLI wajib diarsipkan** (`Photo.originalKey`) di samping versi
  ber-cap — cap dibakar ke gambar dan tidak bisa dibatalkan, jadi tanpa aslinya
  perbaikan cap mustahil. DILARANG menghapus jalur arsip ini. DECISIONS 197.
- **Cap foto tidak boleh menyatakan yang tidak diketahui**: koordinat cadangan
  titik proyek wajib ber-penanda + `gpsSource = project` (jangan dihitung
  sebagai bukti GPS); jam yang tak diketahui → tulis tanggal saja. Ingat kolom
  tanggal kerja `@db.Date` = tengah malam UTC = **07:00 WIB** kalau diformat
  lengkap — itu bukan data. DECISIONS 197.
- **Angka yang DIUNGGAH user dipakai apa adanya**, tidak diskalakan/dibetulkan
  diam-diam ke versi sistem. Kalau invarian memaksa penyesuaian (kurva-S wajib
  tuntas 100%), penyesuaiannya harus seragam DAN dikatakan di UI; selisih yang
  terlalu besar DITOLAK dengan menyebut penyebabnya, bukan diperbaiki sendiri.
  Perilaku "disesuaikan ke sistem" harus DIMINTA user. DECISIONS 203.
- Server Component default; `"use client"` seperlunya; mutasi via Server Action
  (FormData + zod + `useActionState` + `Banner`).
- Tabel data → `MarlinGrid`; KPI/ringkasan → `KpiCard`; status → `StatusPill`
  dgn label/tone dari `lifecycle.ts`.
- **SEMUA dropdown form → `Combobox`** (bisa diketik-cari), TIDAK PERNAH
  `<select>` native — DECISIONS 094/115/174, dijaga lint. Satu-satunya
  pengecualian: primitive `ui/field.tsx` & halaman `app/cetak/`.
- Daftar pilihan yang bersumber dari data (mis. katalog lokasi) hanya
  menampilkan yang MASIH TERSEDIA; yang disembunyikan disebut jumlahnya
  supaya "tidak muncul" tak terbaca "tidak ada".
- DB snake_case via `@map`; file kebab-case; URL kebab-case Indonesia.

## Kalau Ragu

- Data model / KKP format / UX lapangan / phrasing Indonesia → tanya user (Hery —
  kritis, tidak suka basa-basi, weakness duluan).
- Auth/permission → high-stakes, tanya.
- Jangan menghidupkan kembali pola pra-rebuild (lihat DECISIONS 051 utk daftar
  yang sengaja dibuang).
