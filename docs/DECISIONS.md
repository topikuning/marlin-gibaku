# DECISIONS.md

Decision log · **append-only**. Setiap keputusan design/arsitektur/produk
yang di-lock, catat di sini dengan konteks + alasan + alternatif yang di-reject.

Format:
```
## DDD · YYYY-MM-DD · Keputusan Singkat

**Konteks**: kenapa harus mutuskan
**Keputusan**: apa yang dipilih
**Alternatif direject**: apa saja
**Konsekuensi**: side effect
**Bisa di-revisit**: kapan boleh review ulang
```

DDD = decision ID sequential.

---

## 001 · 2026-07-09 · Stack utama

**Konteks**: butuh full-stack framework yang bisa serve mobile PWA + desktop
dari 1 codebase, deploy mudah ke Railway.

**Keputusan**: Next.js 15 (App Router) + React 19 + TypeScript strict.

**Alternatif direject**:
- Remix — bagus tapi lebih niche, less ecosystem
- SvelteKit — team ID familiar React
- Separate SPA + API (Vite React + Fastify) — 2x deploy, tidak SSR

**Konsekuensi**: Server Components jadi default, `"use client"` cuma saat perlu.

---

## 002 · 2026-07-09 · Database + ORM

**Konteks**: butuh JOIN + JSONB + RLS + mature ecosystem.

**Keputusan**: PostgreSQL 17 (Railway managed) + Prisma 6.

**Alternatif direject**:
- Supabase — vendor lock, kurang fleksibel untuk RLS custom
- MongoDB — butuh joins berat, tidak worth
- Drizzle — bagus tapi Prisma lebih matang untuk migration

---

## 003 · 2026-07-09 · Auth strategy

**Konteks**: user gaptek (Site Manager lapangan). Email tidak dipakai.

**Keputusan**: Phone number + PIN 6 digit + device binding + OTP WA (via
WAHA bot existing) saat login device baru.

**Alternatif direject**:
- Magic link email — SM tidak buka email
- SMS OTP — cost Rp 400/msg × 400 users × 4 login/bulan = mahal
- WebAuthn/biometric — HP non-flagship suka bermasalah
- OAuth Google — sama, gaptek user tidak paham

**Konsekuensi**: dependency ke WAHA bot untuk OTP. Fallback kalau bot down:
admin manual reset PIN via UI.

---

## 004 · 2026-07-09 · Photo storage

**Konteks**: 100 lokasi × 10 foto/hari × 300 hari = 300k foto. Storage +
bandwidth cost matter.

**Keputusan**: Cloudflare R2 (S3-compatible). Direct upload dari client
via presigned URL, tidak lewat Next.js server.

**Alternatif direject**:
- Railway volume — mahal untuk foto scale, egress mahal
- Supabase Storage — vendor lock ke Supabase
- Backblaze B2 — R2 lebih murah + egress free
- Foto di Postgres BYTEA — anti-pattern, bloat DB

**Konsekuensi**: butuh account Cloudflare + R2 setup. Egress $0.

---

## 005 · 2026-07-09 · Progress reporting = volume, bukan slider %

**Konteks**: Site Manager di lapangan tahu volume yang selesai
(misal "cor 3.2 m³"), bukan progress %.

**Keputusan**: Progress dilaporkan sebagai **volume selesai** per RAB item
dalam satuan asli (m², m³, kg). % adalah _derived_ value.

**Alternatif direject**:
- Slider 0-100% per item — data lossy, KKP butuh volume untuk BAP
- Manual input % — SM harus reverse-calculate dari volume, error prone

**Konsekuensi**: butuh detailed RAB tree (parsed dari HPS). Data lebih kaya.

---

## 006 · 2026-07-09 · Data model append-only

**Konteks**: KKP audit trail wajib. Koreksi tidak boleh menghapus data asli.

**Keputusan**: 4 tabel append-only: `daily_reports`, `contract_amendments`,
`audit_logs`, `location_status_history`. Koreksi = insert row baru dengan
`supersedes_id`.

**Alternatif direject**:
- Soft delete dengan `deleted_at` — masih bisa modify content
- Event sourcing — over-engineering untuk MVP

**Konsekuensi**: butuh trigger enforcement. UI harus tunjukkan "koreksi X"
di history.

---

## 007 · 2026-07-10 · Site Manager sebagai single accountability

**Konteks**: 40+ items paralel per lokasi. Mandor di lapangan gaptek.
Multi-user login (mandor punya akun sendiri) = 400+ user gaptek = beban
training + support tidak masuk akal.

**Keputusan**: SM = **single point of accountability**. Mandor cuma nomor
HP terdaftar. Draft masuk via WA text template. SM approve/reject.

**Alternatif direject**:
- Mandor login sendiri — training beban 400+ orang
- Voice-note dari mandor + LLM parsing — user reject explicit: "tidak
  berguna, akan malah banyak buang waktu di situ tapi implementasi
  lapangannya tidak efektif"

**Konsekuensi**: butuh WAHA bot integration untuk terima WA text mandor,
parse dengan template struktur, buat draft di app SM.

---

## 008 · 2026-07-10 · Weekly Plan advisory, tidak locking

**Konteks**: KKP butuh laporan rencana mingguan. Tapi realita lapangan
sering berubah — plan tidak boleh block SM lapor item lain.

**Keputusan**: `weekly_plan_items` = target minggu ini. Kalau SM lapor
item di luar plan, `daily_report_items.wasOutsidePlan = true`. Cuma flag,
tidak block. Progress tetap masuk total.

**Alternatif direject**:
- Lock ke plan — realita lapangan tidak bisa dipaksa
- Tidak ada plan sama sekali — KKP butuh laporan rencana

---

## 009 · 2026-07-10 · Kurva-S auto-generated dari RAB

**Konteks**: PM tidak mau input manual per item untuk 83 lokasi × ratusan
items. HPS Excel sudah ada bobot per kategori.

**Keputusan**: Algoritma auto-generate kurva-S dari RAB + durasi kontrak.
Setiap kategori di-map ke phase window (lookup table 34 keyword). Bobot
didistribusi dalam phase pakai cubic smoothstep. Editable per item nanti
kalau perlu.

**Algoritma**: `src/lib/scurve.ts` (TS port dari `scripts/scurve.py`).

**Alternatif direject**:
- PM input manual — beban tidak realistic
- Linear distribution — tidak S-shape
- ML-based dari day 1 — tidak ada training data

**Konsekuensi**: baseline algoritma. Perlu validasi dengan data historis
KNMP yang selesai untuk refine. Category-phase mapping harusnya di DB
(sekarang hardcoded — issue di OPEN_ISSUES.md).

---

## 010 · 2026-07-10 · Rollout 83 lokasi day 1, bukan pilot

**Konteks**: user (Hery) prefer full launch. POC pilot dianggap
memperlambat.

**Keputusan**: 83 lokasi aktif dari day 1.

**Alternatif direject**:
- POC 1 lokasi — user reject
- Pilot 5 lokasi — user reject

**Konsekuensi**:
- User provisioning perlu bulk import CSV dari hari 1
- RLS testing di scale (400+ users)
- Backup + monitoring wajib hari 1
- Support incident response plan wajib

---

## 011 · 2026-07-10 · Contract 1:1 dengan Location (tentatif)

**Konteks**: dari inspeksi 7 file HPS, 1 file = 1 lokasi.

**Keputusan**: `contracts.locationId @unique`. Refactor ke `contract_locations`
join table kalau realita 1:N.

**Perlu validasi**: user belum konfirmasi eksplisit. Kalau salah, refactor
di v0.1 atau v0.2.

---

## 012 · 2026-07-10 · Session duration per role

**Konteks**: SM sering pakai HP (30 hari session masuk akal). Exec view
sensitive data, harus refresh sering.

**Keputusan**:
- `site_manager`: 30 hari (sliding)
- `project_manager`, `regional_manager`: 7 hari
- `super_admin`, `program_director`, `exec_viewer`: 24 jam

**Alternatif direject**: universal 30 hari — terlalu longgar untuk role admin.

---

## 013 · 2026-07-10 · Voice-note DROPPED

**Konteks**: proposal awal untuk mandor rekam voice → STT + LLM parse →
draft di app SM.

**Keputusan**: DROPPED. Mandor pakai WA text dengan template struktur
saja. Text lebih reliable dari voice di lokasi bising + dialek + istilah
teknis.

**Alternatif direject**: LLM parsing voice — user judgment: "tidak berguna,
akan malah banyak buang waktu di situ tapi implementasi lapangannya tidak
efektif".

---

## 014 · 2026-07-10 · Grand total = SUM kategori aktif (bukan Resume sheet)

**Konteks**: HPS Excel punya 2 angka total: (a) SUM kategori aktif di RAB,
(b) angka di Resume sheet. Bedanya karena Resume kadang include kategori
dengan value 0.

Untuk Kedungmutih: (a) Rp 3.06M, (b) Rp 3.13M.

**Keputusan**: Pakai (a) untuk konsistensi dengan cara hitung realisasi
(item-by-item cumulative).

**Konsekuensi**: kalau KKP request pakai angka Resume, harus tambah field
`contracts.contract_value_kkp_resume` sebagai display-only.

---

## 015 · 2026-07-10 · PROJECT.md + CLAUDE.md + docs/ sebagai kontrak

**Konteks**: sesi Claude reset. Butuh context persist untuk 8-12 sesi
coding.

**Keputusan**: 4 file jadi kontrak:
- `PROJECT.md` — human-facing, keputusan produk + arsitektur
- `CLAUDE.md` — Claude-facing, working style + commands
- `docs/DECISIONS.md` — decision log append-only (file ini)
- `docs/OPEN_ISSUES.md` — bug + technical debt

Setiap sesi baru harus baca semua 4 sebelum coding.

---

## 016 · 2026-07-10 · Contract 1:N Location (OVERRIDE 011)

**Konteks**: keputusan 011 asumsi 1 SPK = 1 lokasi (tentatif, belum divalidasi).
User (Hery) konfirmasi eksplisit: **1 kontrak bisa mencakup beberapa lokasi**.

**Keputusan**: Contract 1:N Location. Implementasi **FK di sisi Location**
(`locations.contract_id`, buang `@unique`), **bukan** `contract_locations`
join table. Join table hanya perlu kalau N:N (1 lokasi milik banyak kontrak) —
itu tidak terjadi. FK 1:N lebih sederhana + cukup.

**Alternatif direject**:
- Pertahankan 1:1 (011) — user override
- `contract_locations` join table — over-engineering untuk 1:N, cuma perlu kalau N:N

**Konsekuensi**: `Contract.contractValue` + tanggal = level kontrak (shared antar
lokasi di bawahnya). Grand total realisasi tetap per-lokasi dari RAB (014).
Data seed sekarang masih de-facto 1:1 (tiap file HPS punya `contract_number`
sendiri) — schema mendukung 1:N, data ikut kalau ada SPK gabungan riil.

**Bisa di-revisit**: kalau ternyata ada lokasi di bawah >1 kontrak → baru join table.

---

## 017 · 2026-07-10 · Contractor tabel terpisah (OVERRIDE OPEN_ISSUES)

**Konteks**: `contracts.contractor_name` sebagai string. 1 kontraktor pegang
banyak kontrak (mis. PT Nusantara Bahari Utama = 3 lokasi). String = duplikasi +
tidak bisa referensi konsisten.

**Keputusan**: tabel `contractors` (id, org_id, name, npwp). `contracts.contractor_id`
FK. Contractor 1:N Contract 1:N Location.

**Alternatif direject**: string di contracts — duplikasi, tidak bisa 1 kontraktor N kontrak.

**Konsekuensi**: seed extract distinct contractor dari `meta.contractor`. Unique
`(org_id, name)`.

---

## 018 · 2026-07-10 · Mandor jadi role login + multi-lokasi (OVERRIDE 007 & 013)

**Konteks**: keputusan 007 & 013 menetapkan mandor = **bukan role login** (cuma
nomor HP, draft via WA, SM approve). Alasan waktu itu: 400+ user gaptek = beban
training/support tidak masuk akal. User (Hery) override: **mandor harus login**,
karena mandor juga di lapangan dan **bisa di beberapa lokasi**.

**Keputusan**: `field_supervisor` masuk `UserRole` enum sebagai role login.
Multi-lokasi didukung lewat `user_location_assignments` yang **sudah N:N** — mandor
tinggal dapat banyak assignment (tidak perlu schema change untuk itu).

**Alternatif direject**: mandor tanpa login (007) — user override eksplisit.

**Konsekuensi & risiko (dicatat, bukan diabaikan)**: membalik alasan inti 007.
Beban training/support day-1 (rollout 83 lokasi) naik signifikan karena populasi
user gaptek bertambah dari ~SM+admin ke +mandor. Flow WA-draft (`ReportItemState.
draft_mandor`, `SuggestionSource.wa_text`) tetap ada tapi jadi opsional/sekunder.
**Belum diputuskan** (v0.2): apakah mandor submit langsung, atau tetap SM yang
approve item dari mandor. Perlu klarifikasi sebelum bangun SM/mandor core flow.

**Bisa di-revisit**: kalau beban support terbukti tidak sustainable di lapangan.

---

## 019 · 2026-07-10 · Auth = username/email + password (OVERRIDE 003 & PROJECT §8)

**Konteks**: keputusan 003 + PROJECT §8 = phone + PIN + device binding + OTP WA
(WAHA). User (Hery) override: **pakai username/email + password**, **tanpa** OTP
WA/email dan **tanpa** device-binding untuk sekarang. Prioritas: simpel dulu.

**Keputusan**:
- Login identifier: `username` ATAU `email` (keduanya `@unique` nullable, minimal
  satu wajib — enforced via CHECK `users_login_identifier_present`).
- `pin_hash` → `password_hash`. Hashing tetap Argon2id (`@node-rs/argon2` default).
- `phone_e164` jadi nullable (data kontak, bukan kredensial).
- Auth.js v5 Credentials provider, session **JWT** (lihat 021).
- Tabel `devices` + `otp_codes` **dibiarkan dormant** (tidak dihapus) untuk
  kemungkinan re-enable device-binding/OTP nanti.

**Alternatif direject**: phone+PIN+OTP+device (003) — user override, terlalu banyak
friction untuk fase sekarang.

**Konsekuensi**: keamanan lebih longgar (tidak ada 2FA/device binding). Rate limit
login + enforce ganti password first-login masih TODO (OPEN_ISSUES).

**Bisa di-revisit**: sebelum go-live produksi, pertimbangkan re-enable OTP/device
binding untuk role sensitif (admin/exec).

---

## 020 · 2026-07-10 · Drop extension postgis

**Konteks**: schema deklarasi `extensions = [postgis, pgcrypto]`. Inspeksi: tidak
ada satupun kolom geometry/geography. GPS = `Decimal(10,7)`, geofence = radius `Int`.
postgis juga tidak terinstall di environment dev standar.

**Keputusan**: buang `postgis` dari datasource extensions. Keep `pgcrypto`
(untuk `gen_random_uuid()`).

**Alternatif direject**: pertahankan postgis "untuk jaga-jaga" — dead weight +
gagal migrate di env tanpa postgis.

**Konsekuensi**: kalau nanti butuh query spatial (radius search di DB), tambah
lagi + migrasi kolom geometry. Sekarang geofence check dilakukan di app layer.

---

## 021 · 2026-07-10 · Session JWT + per-role expiry (resolve OPEN_ISSUES)

**Konteks**: OPEN_ISSUES buka pertanyaan JWT (stateless) vs DB session (revocable).
Keputusan 012 sudah lock durasi per-role.

**Keputusan**: **JWT** (stateless, tanpa DB adapter) untuk sekarang. Durasi per-role
(012) di-enforce via klaim `absExp` di token: dihitung saat sign-in, dicek di `jwt`
callback — lewat batas → return null → force sign-out. `field_supervisor` = 30 hari
(seperti site_manager, user lapangan).

**Alternatif direject**: DB session — revocable + force-logout, tapi butuh adapter +
query tiap request. Belum worth untuk MVP.

**Konsekuensi**: cookie `maxAge` global = 30 hari (durasi role terpanjang); expiry
ketat per-role via `absExp`, bukan via cookie lifetime. Force-logout global (mis.
setelah ganti password) belum ada — perlu DB session atau token version. Dicatat di
OPEN_ISSUES.

**Bisa di-revisit**: kalau butuh force-logout/revocation → pindah ke DB session.

---

## 022 · 2026-07-10 · RabItem parent-child onDelete Cascade

**Konteks**: relasi self `rab_items.parent_item_id` default `onDelete: SetNull`.
Kombinasi dengan CHECK dual-parent baru (`rab_items_parent_present`): hapus item
induk → anak yang parent-nya cuma via `parent_item_id` jadi all-null → langgar CHECK.
Ketahuan saat seed re-run.

**Keputusan**: `onDelete: Cascade` pada relasi self. Semantik benar: sub-item tidak
boleh hidup tanpa induknya.

**Alternatif direject**: buang CHECK dual-parent — invariant-nya benar, jangan dilemahkan.

---

## 023 · 2026-07-11 · RAB revisioning = snapshot per revisi (Model A)

**Konteks**: RAB bisa berubah via adendum/CCO. History RAB lama WAJIB tetap ada
(audit KKP), dan realisasi yang sudah masuk tidak boleh berubah retroaktif.

**Keputusan**: **Model A — snapshot per revisi** (dipilih user atas opsi change-log).
Tabel `rab_revisions` (contractId, revisionNo, sourceType initial_hps|adendum,
amendmentId→CCO, effectiveDate, status active|superseded). Kategori/subkategori/item
dapat `revisionId`. Adendum = clone pohon aktif → revisi baru → revisi lama
`superseded` (tak pernah dihapus). `lineageId` untuk kontinuitas item lintas revisi
(supaya volume realisasi nyambung). Adendum durasi → regenerate kurva-S (milestones
juga versioned).

**Status**: DIPUTUSKAN, **belum dibangun** — menunggu 2-3 sample HPS (format mirip
tapi tak identik antar lokasi) untuk bikin importer toleran.

**Alternatif direject**: change-log ringan (B) — user pilih A untuk audit yang bersih.

---

## 024 · 2026-07-11 · Arsip dokumen mengikuti siklus PBJ + storage R2

**Konteks**: tiap lokasi butuh arsip digital dokumen resmi (surat, BA, pengajuan)
mengikuti tahapan Pengadaan Barang/Jasa pemerintah (Perpres 16/2018 jo 12/2021).

**Keputusan**: tabel `documents` (append-only) dengan `stage` (enum: pemilihan,
penunjukan, kontrak, mulai_kerja, pelaksanaan, adendum, serah_terima, pembayaran,
lainnya) + `type` granular (undangan, SPPBJ, SPMK, MC0, BAST, faktur_pajak, dst).
File di **Cloudflare R2** (`r2_key`), metadata di Postgres. Upload lewat server
action (≤15MB), download via presigned GET (privat, authz per lokasi). Halaman
"Arsip Dokumen" per lokasi + indikator kelengkapan per tahap.

R2 di-wire di `src/lib/r2.ts` (S3-compatible, forcePathStyle, presigned URL).
Prasyarat bersama untuk foto laporan (v0.3) + lampiran adendum.

**Alternatif direject**: flat file dump tanpa stage — tidak cocok untuk audit/
kelengkapan administrasi KKP. Presigned direct-upload dari browser — ditunda
(server-side upload cukup untuk dokumen; presigned untuk foto/berkas besar nanti).

**Taksonomi jenis dokumen** bisa di-revisit kalau istilah resmi KKP berbeda.

---

## 025 · 2026-07-11 · Foto bukti menempel ke item laporan (draft), tampil ke approver

**Konteks**: SM/mandor perlu lampirkan foto bukti saat lapor harian; approver (SM)
perlu lihat foto sebelum menyetujui. Model `Photo` sudah ada di schema (r2Key/sha256
unik), R2 sudah wired dari fitur dokumen.

**Keputusan**: foto diunggah bareng draft lewat server action `submitDraftItem`
(input `<input type=file accept=image/* capture=environment multiple>`), disimpan ke
R2 di `report-photos/<reportItemId>/…`, dan dibuat row `Photo` dengan
`reportItemId`. Dedup byte-identik via `sha256`. Kegagalan upload foto **tidak**
membatalkan draft yang sudah tersimpan (foto opsional). Thumbnail ditampilkan di
daftar draft SM (`/lokasi/[slug]/lapor`) dan di antrian persetujuan (`/laporan`).

**Serving**: presigned GET di-generate langsung di server component halaman yang
sudah otorisasi lokasinya (bukan lewat API route seperti dokumen) — halaman sudah
memfilter per akses lokasi, jadi tak perlu reverse-authz foto → lokasi. URL
berumur pendek (5 menit), di-render fresh tiap load.

**Belum**: verifikasi EXIF/GPS (`PhotoVerification` masih `pending`), thumbnail
server-side (pakai foto asli langsung), galeri per lokasi. Menyusul.

**Alternatif direject**: API route `/api/photos/[id]` + reverse-authz via recursive
CTE rab_item→lokasi — lebih berat, tak perlu karena halaman sudah scoped.

---

## 026 · 2026-07-12 · Beranda = overview (Dashboard digabung), grandTotal dari kategori aktif

**Konteks**: user protes "konyol ada Beranda ada Dashboard" — dua halaman overview
membingungkan. Plus Dashboard tampil "Rp 0 / deviasi −100%" di semua lokasi karena
`getLocationProgress` membaca `rabRevision.totalValue` (bisa basi/0), bukan sumber
kebenaran.

**Keputusan**:
1. **Hapus menu Dashboard terpisah.** Beranda jadi satu-satunya landing: untuk role
   ber-dashboard (super_admin, PD, exec, RM, PM) menampilkan ringkasan progress +
   tabel kurva-S per lokasi; untuk SM/Mandor menampilkan lokasi + tombol Lapor
   Harian. `/dashboard` redirect ke `/beranda` (link lama tetap hidup).
2. **grandTotal = SUM `rabCategory.totalValue` kategori aktif** (sesuai DECISIONS
   014), konsisten dengan halaman detail lokasi. Tidak lagi pakai
   `rabRevision.totalValue` yang denormalized & rawan basi.

**Catatan**: kalau di produksi Total Nilai masih Rp 0 setelah ini, berarti DB prod
belum ter-seed data RAB terbaru → jalankan seed (`SEED_ON_DEPLOY=true` saat deploy).

**Alternatif direject**: pertahankan dua halaman tapi bedakan isinya — user eksplisit
mau satu. Sinkronkan `rabRevision.totalValue` tiap tulis — tetap dobel sumber
kebenaran; lebih baik hitung dari kategori.

---

## 027 · 2026-07-12 · Kurva-S rencana ber-versi: auto-generate + editable, regenerate saat adendum

**Konteks**: kurva-S rencana sebelumnya cuma hasil rumus (`generateScurve`) yang
ditanam saat seed — tidak ada UI atur, bukan jadwal resmi kontraktor, dan tidak
ikut berubah saat adendum. User (Hery) memilih: **auto-generate sebagai titik awal
tapi bisa diedit**, dan **adendum → regenerate + simpan histori**.

**Keputusan**:
1. Tabel baru `scurve_plans` (planNo, source: auto|adendum|manual, status:
   active|superseded, basedOnRevisionId, contractDays) + `scurve_milestones`
   (weekNumber, targetProgressPct). Satu plan aktif per lokasi; sisanya arsip.
2. **Seed** membuat plan #1 (auto, active) dari `generateScurve`.
3. **Import/adendum RAB** memanggil `createAutoPlan` → plan baru active, plan lama
   superseded (histori tetap). Sumber `adendum` untuk revisi, `auto` untuk RAB awal.
4. **Halaman Atur Kurva-S** (`/lokasi/[slug]/kurva-s`, admin): edit target % per
   minggu (validasi kumulatif tak turun) → plan jadi `manual`; tombol "Generate
   ulang dari rumus". Preview chart + riwayat plan.
5. `progress.ts` & `scurve-data.ts` baca `getPlannedSeries` (plan aktif), fallback
   ke `scheduled_milestones` lama biar data lama tetap tampil.

**Terverifikasi lokal**: seed→plan#1 auto; createAutoPlan(adendum)→plan#2 active +
plan#1 superseded; updatePlanMilestones→source manual, nilai berubah.

**Belum**: milestone per-item (masih location-level), diff visual antar versi plan,
import time-schedule kontraktor mentah (sekarang input manual per minggu).

**Alternatif direject**: input jadwal kontraktor penuh (paling akurat, tapi berat
untuk user lapangan) — dipilih hybrid. Mutasi `scheduled_milestones` langsung —
tak punya histori antar adendum; tabel ber-versi lebih bersih.

---

## 028 · 2026-07-12 · Pembobotan PER ITEM + jadwal dependensi + saran mingguan

**Konteks**: user mau kurva-S dari pembobotan tiap item (bukan level kategori) +
saran "apa yang dikerjakan tiap minggu" berbasis dependensi konstruksi riil.

**Keputusan** (`src/lib/scheduling.ts`):
1. **Bobot per item** = `total_price` item ÷ grand total (leaf saja, bukan header
   agregat — cegah dobel).
2. **Klasifikasi trade** tiap item via kata kunci nama item (fallback nama
   kategori) → 11 trade: persiapan, tanah, pondasi, struktur, dinding, atap, mep,
   finishing, sarana_luar, landscape, lainnya. Taksonomi & kata kunci diturunkan
   dari analisis **7 RAB KNMP nyata (~11.800 item)**; cakupan ≈97%.
3. **Jadwal dependensi**: tiap trade punya jendela `[start,end]` fraksi durasi yang
   urutannya mencerminkan precedence riil (persiapan→tanah→pondasi→struktur→
   dinding/atap→MEP→finishing; sarana luar paralel; landscape terakhir). Distribusi
   dalam jendela pakai smoothstep.
4. **Output**: kurva-S kumulatif (dipakai `createAutoPlan` & seed) + **saran
   pekerjaan per minggu** (trade dominan tiap minggu) di halaman Atur Kurva-S.

**Terverifikasi (DB lokal, kedungmutih)**: 1.283 item leaf, klasifikasi 96,6%,
kurva monotonik 3%→100%, urutan mingguan benar (persiapan→…→landscape).

**Belum (roadmap "scheduling saran di kemudian hari")**: precedence antar-bangunan
eksplisit (CPM penuh), durasi item dari sumber daya/kurva historis, saran adaptif
berdasarkan realisasi aktual (mis. "telat di struktur → geser finishing"), dan
klasifikasi item 'lainnya' pakai LLM. Sekarang deterministik (rule-based) supaya
auditable, cepat, konsisten.

**Alternatif direject**: klasifikasi 1.700 item/lokasi via LLM saat runtime —
lambat, mahal, non-deterministik; AI dipakai sekali (analisis 7 RAB → aturan).

---

## 029 · 2026-07-12 · Peta lokasi (Leaflet) — klik titik → progress + fase + foto

**Konteks**: user punya app Cloudflare "Area Manager" (Leaflet + D1) yang lokasinya
menempel di peta; ingin pola itu di MARLIN — klik titik lokasi → laporan tiap fase
+ foto. Juga minta rombak total UI/UX + grid open-source (menyusul, bertahap).

**Keputusan (fase 1 — Peta)**:
- Pakai **Leaflet + react-leaflet 5** (open-source, kompatibel React 19), basemap
  CARTO light (sama seperti app Cloudflare-nya). Komponen peta client-only
  (`dynamic ssr:false`) karena Leaflet butuh `window`.
- Menu **Peta** baru. Titik = `Location.gpsLat/gpsLng`, warna per status.
- Klik titik → `GET /api/peta/[id]` (authz per lokasi) → panel: progress
  (realisasi vs rencana + deviasi), **fase minggu ini** (dari saran mingguan
  DECISIONS 028), **foto terbaru** (presigned), link ke detail.
- Scoped role hanya lihat lokasi yang ditugaskan.

**Terverifikasi**: server lokal + Playwright — 7 titik render, klik "Tengket"
memunculkan panel progress + chip fase (Atap, Dinding, Struktur, Sarana luar) +
tombol detail. (Tile CDN tak termuat di sandbox tanpa internet; di Railway normal.)

**Roadmap lanjutan (belum, permintaan user)**: rombak total UI/UX modern, data
grid open-source LTS (TanStack Table/AG Grid Community) ganti tabel kaku, tampilan
mobile mandor untuk lapor harian, layer Area Manager + org chart, tracker Pengadaan
tahapan PBJ (dari app Cloudflare). Dikerjakan bertahap per PR.

---

## 030 · 2026-07-12 · Pengadaan = status per lokasi + tampilan eksekutif; Area Manager = scoped

**Konteks**: user memutuskan pengadaan **tak butuh tabel terpisah** — cukup
**status per lokasi** yang di-set, lalu diagregasi untuk eksekutif. Area Manager
cukup role scoped yang hanya lihat area-nya.

**Keputusan**:
1. Enum `ProcurementStage` (belum_diundang→diundang→negosiasi→sppbj→kontrak→
   survey→pcm→spmk) + kolom `Location.procurementStage` (default belum_diundang).
2. Halaman **/pengadaan** (role ber-dashboard, scoped): KPI (total lokasi, HPS =
   SUM RAB aktif, kontrak, selisih), funnel per tahap, tabel per lokasi dengan
   dropdown tahap (admin set inline → server action `setStage`, authz per lokasi).
   Sekaligus input status + tampilan eksekutif.
3. **Area Manager = `regional_manager`** (relabel). Sudah scoped: role
   non-cross-location hanya lihat lokasi yang ditugaskan — berlaku di Beranda,
   Peta, Lokasi, Pengadaan.
4. Seed set semua lokasi ke `spmk`.

**Terverifikasi**: server lokal + Playwright — funnel & KPI benar (Negosiasi 1,
Kontrak 1, SPMK 5), dropdown tahap tersimpan.

**Belum**: org chart visual Area Manager — menyusul di fase design-system.

**Alternatif direject**: tabel `procurements` terpisah (app Cloudflare) — user mau
satu sumber (per lokasi).

---

## 031 · 2026-07-12 · Lapor Harian mobile-first (redesign untuk mandor)

**Konteks**: tampilan lapor harian lama pakai `<select>` native berisi 1000+ item
RAB — tidak bisa dipakai mandor di HP. User minta mobile-first modern.

**Keputusan**: form Lapor Harian dirombak jadi stepped + touch-friendly:
1. **Pilih pekerjaan** = search box + daftar hasil (tap pilih), bukan select 1000
   item. Item terpilih tampil sebagai kartu + tombol "Ganti".
2. **Volume** = input besar, satuan di label.
3. **Foto** = tombol kamera besar (capture) + preview thumbnail (objectURL).
4. Catatan opsional; tombol simpan **sticky**, disabled sampai item dipilih.
5. Riwayat laporan jadi **kartu** (bukan tabel) dengan status pill + thumbnail foto.
Form reset otomatis setelah sukses.

**Terverifikasi**: Playwright viewport 390px sbg `mandor-01` — search "beton" filter
benar, pilih item → kartu + volume(m²) + kamera + simpan; riwayat kartu.

**Belum**: offline/queue (mandor sinyal lemah), kompresi foto client-side.
