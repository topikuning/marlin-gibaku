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

---

## 032 · 2026-07-12 · Data grid open-source (TanStack Table) ganti tabel kaku

**Konteks**: user minta tabel diganti data grid modern, open-source, versi terkini.

**Keputusan**: pakai **TanStack Table v8** (`@tanstack/react-table`, MIT, React 19).
Headless → di-styling sesuai MARLIN (bukan tabel bawaan). Komponen reusable
`src/components/knmp/data-grid.tsx`: sort per kolom (klik header), global search,
sticky header, hover row, empty state, alignment via `column.meta.align`.

Diterapkan ke: **Pengguna** (`users-grid`), **Kontrak & Kontraktor**
(`kontrak-grids`). Data di-serialize ke row polos di server (BigInt→number,
tanggal→string + ms utk sort); cell renderer + server action (mis. aktif/nonaktif)
di komponen client.

**Terverifikasi**: Playwright — sort "Role ▲" & search "mandor" memfilter benar.

**Belum**: pagination/virtualization (belum perlu, data kecil), column resize,
grid untuk Pengadaan (masih tabel dgn dropdown inline) & RAB tree.

---

## 033 · 2026-07-12 · Lapor harian: satuan jelas + blokir volume > rencana + visibilitas laporan/foto

**Konteks**: user lapor 3 hal: (1) satuan kurang jelas, (2) qty rencana 3 tapi input
4 lolos (tak ada validasi), (3) bingung di mana lihat laporan & foto tersimpan.

**Keputusan**:
1. `ReportableItem` kini bawa `volume` (rencana). Form tampilkan **satuan** sebagai
   badge di input volume + "rencana X unit" di kartu item + hint "Maksimal X unit".
2. **Blokir server-side**: kalau kumulatif (`priorSent + volumeDone`) > volume
   rencana item → tolak dengan pesan sisa. Realisasi tak boleh > 100% item RAB.
3. Halaman lapor kasih penjelas: "Laporan Anda" = tempat semua laporan+foto tampil;
   SM approve di menu Laporan. Foto yang tak bisa di-presign (R2 belum aktif) tampil
   placeholder "tersimpan" (bukan hilang diam-diam).
+ Shell: brand header refresh (glow dot + subtitle "Monitoring KNMP").

**Terverifikasi**: Playwright — input 999999 pada item rencana 0.14 m³ diblokir
dengan pesan sisa; badge satuan m³ tampil.

**Belum**: izinkan over-volume via adendum/CCO eksplisit (sekarang hard block).

---

## 034 · 2026-07-12 · Halaman Laporan: detail approval + section "Sudah disetujui" + admin lihat semua

**Konteks**: SM protes — tak bisa lihat laporan yang sudah disetujui, dan proses
approval minim (cuma tombol setuju + alasan tolak, tanpa detail). Admin juga harus
bisa lihat semua laporan.

**Keputusan** (`/laporan`):
1. Kartu pending diperkaya: **Dilaporkan / Kumulatif (X / rencana, %) / Sisa** per
   satuan, pelapor + tanggal-waktu, catatan, foto besar (72px). Bukan cuma tombol.
2. Section baru **"Sudah disetujui"** (state `sent`, 30 terbaru): item, volume,
   pelapor, penyetuju, waktu, foto — sebelumnya tak ada sama sekali.
3. **Admin lihat semua**: super_admin/PD = approver + cross-location → otomatis
   melihat pending + approved di semua lokasi. SM/PM/regional = scoped ke lokasinya.

**Terverifikasi**: Playwright sbg `sm-kedungmutih` — pending menampilkan
210/700 m² (30%), sisa 490 m²; section "Sudah disetujui" menampilkan item + penyetuju.

**Belum**: filter/pagination di daftar approved (baru take 30), section rejected.

---

## 035 · 2026-07-12 · Design system enterprise + shell sidebar (Command Center)

**Konteks**: user beri referensi dashboard "Portfolio Command Center" + spesifikasi
gaya: enterprise modern (bukan startup penuh animasi), latar putih/abu sangat muda,
satu warna merek, hijau/kuning/merah hanya untuk status, font Inter/Geist/IBM Plex,
tabular numerals, sudut kartu 6–10px, tanpa gradient/glass/bayangan berlebihan,
padat tapi lapang, terang default.

**Keputusan (langkah 1)**:
1. **Shell sidebar kiri** (desktop): logo + "Command Center" + `SideNav` (ikon garis
   inline, tanpa lib), warna aktif = brand teal 10% + teks teal. Top bar: user +
   keluar. Mobile: sidebar disembunyikan, nav horizontal (`AppNav`) di header.
2. **Token enterprise**: kartu `rounded-lg` (8px), border slate-200, tanpa
   gradient/glass/backdrop-blur (logo & header solid), shadow minimal, angka
   `tabular-nums`, label uppercase slate-500. Satu warna merek = teal `#0F766E`;
   hijau/kuning/merah khusus status.
3. **Beranda = Portfolio Command Center**: KPI row (Total Lokasi, Nilai Kontrak,
   Nilai RAB, Realisasi Fisik, Nilai Terpasang, Proyek Bermasalah) + tabel Kinerja
   Proyek (status pill Sesuai/Perhatian/Kritis/Belum Mulai) + Distribusi Status.

**Terverifikasi**: Playwright desktop 1440px sbg admin — sidebar+KPI+tabel+distribusi
tampil sesuai gaya referensi.

**Belum (roadmap, bertahap)**: modul Keuangan (serapan, kas 30 hari, nilai selesai
belum ditagih, budget cap), Progress detail (forecast, milestone, penyebab deviasi,
recovery plan), Risiko & Kendala, Organisasi/org-chart, Laporan (export KKP),
tenaga kerja di lapor harian, dark mode. Restyle halaman lain ke token baru menyusul.

**Catatan teknis**: saat verifikasi, `pnpm build` yang jalan bersamaan dengan
`next start` lama sempat merusak `.next` (halaman tak ber-CSS). Solusi: kill server
lama → `rm -rf .next` → build → start bersih. Bukan bug kode.

---

## 036 · 2026-07-13 · Modul Keuangan — input manual per lokasi + derivasi

**Konteks**: user minta modul keuangan (serapan, nilai selesai belum ditagih,
pengeluaran vs budget cap, kebutuhan dana 30 hari). Sumber data belum ada sistem
penagihan/pembayaran → diputuskan **input manual per lokasi** (tanpa tanya, sesuai
"kerjakan semua").

**Keputusan**: kolom `Location`: `invoicedValue`, `paidValue`, `spentValue`,
`budgetCap` (BigInt, default 0, input manual admin). Derivasi:
- Nilai Terpasang = realisasi (SUM value_done sent) — dari progress.
- Selesai belum ditagih = terpasang − invoiced.
- Serapan = paid ÷ kontrak.
- Kebutuhan 30 hari = nilai fisik rencana 4 minggu ke depan (dari kurva-S plan).
Halaman **/keuangan** (role dashboard, scoped): KPI + tabel per lokasi dgn sel
uang editable (admin, format on blur). Menu Keuangan.

**Belum**: integrasi termin kontrak otomatis, histori pembayaran, proyeksi kas
multi-periode. Sekarang snapshot manual.

---

## 037 · 2026-07-13 · Akomodasi format resmi KKP/DJPT (paket dokumen kementerian)

**Konteks**: user kasih paket dokumen resmi kementerian (Alur Administrasi KNMP
2025, template Berita Acara/Surat, FORMAT LAPORAN HARIAN/MINGGUAN/BULANAN, MC-0,
CCO, time schedule, FORMAT DOKUMENTASI). Minta MARLIN "pelajari dan akomodir".

**Analisa spec**:
- **Alur Administrasi** = 40+ milestone dokumen per paket (RAB HPS → DED → RKS →
  SMKK → SPPBJ → Pakta → Jaminan → Kontrak → Serah Terima Lokasi → SPMK → PCM →
  MC-0 → CCO/Adendum → Termin/BAP → SCM → PHO/FHO), tiap milestone punya PIC
  (PPK/Kontraktor/Pengawas/Koperasi).
- **FORMAT LAPORAN HARIAN** KKP jauh lebih kaya: tenaga kerja per keahlian (14
  peran), rekap material masuk, peralatan, cuaca per jam, rencana vs realisasi,
  TTD Pengawas + Kontraktor.
- **MC-0/CCO** = tabel RAB + kolom pekerjaan tambah/kurang → nilai kontrak revisi
  (memetakan ke RAB revisioning + adendum yang sudah ada).
- **time schedule MC.0** = kurva-S KKP (sudah ada, tinggal samakan layout export).

**Keputusan (slice 1, dibangun sekarang)**: **Tracker Alur Administrasi** per
lokasi (`/lokasi/[slug]/administrasi`) — checklist 45 item (8 fase) dari
`src/lib/kkp-admin-flow.ts`, PIC per item, status ✓ auto-deteksi dari `Document`
by `type`. Additive, nol regresi. Milestone tanpa docType = pantau manual.

**Roadmap (slice berikut, belum)**:
1. Enhanced Lapor Harian format KKP — tenaga per keahlian, material, alat, cuaca.
   *Keputusan tertunda*: input mandor WAJIB tetap sederhana (pakem user) → detail
   KKP di-*generate*/di-enrich di level SM/Pengawas, bukan diisi mandor manual.
2. Export KKP: Cover harian/mingguan/bulanan + FORMAT DOKUMENTASI (foto + bobot%).
3. MC-0/CCO view + export dari RAB revisi (tambah/kurang).
4. Generator template Berita Acara/Surat (docx fill).

**Alasan urutan**: tracker administrasi = risiko nol + tulang punggung kepatuhan.
Enhanced daily butuh keputusan UX gaptek dulu (jangan bebani mandor).

---

## 038 · 2026-07-13 · Laporan Harian format KKP — "mandor simpel, SM lengkapi"

**Konteks**: FORMAT LAPORAN HARIAN resmi KKP jauh lebih kaya dari input mandor
(tenaga per keahlian 14 peran, material masuk, peralatan, cuaca, jam kerja,
rencana vs realisasi). Bertabrakan dengan pakem "mandor sederhana saja, ringan".

**Keputusan user**: **mandor tetap ringan** (volume + foto + jumlah tenaga total);
detail KKP di-*enrich* di level **Site Manager** + sebagian **otomatis**; export
format KKP di-*generate*. (User pilih opsi ini eksplisit.)

**Implementasi**:
- Model `DailyLog` (unik per `location + logDate`) + `DailyLogWorker` (14 peran),
  `DailyLogMaterial`, `DailyLogEquipment`. Cuaca + jam kerja + catatan di header.
  Terpisah dari alur item-centric `DailyReportItem` (yang tetap `dailyReportId=null`).
- Halaman `/lokasi/[slug]/harian/[date]`: kartu format KKP (print-friendly) +
  editor SM (gated `canApprove`). Realisasi pekerjaan **auto-join** dari
  `DailyReportItem` state approved/sent yang createdAt-nya jatuh di tanggal itu
  (zona Asia/Jakarta). Tombol Cetak/PDF (window.print + `@media print`).
- Index `/lokasi/[slug]/harian?d=` redirect ke tanggal (default hari ini WIB).

**Belum**: cuaca per jam (KKP punya kolom 07:00–21:00; sekarang 1 cuaca dominan),
export xlsx asli, TTD digital. Rencana pekerjaan (vs realisasi) belum dipisah —
sekarang realisasi dari lapangan + catatan bebas.

---

## 039 · 2026-07-13 · Foto: thumbnail + lightbox + EXIF; Reset penuh "mulai dari nol"

**Konteks (feedback user)**: (1) foto diklik buka tab baru — tak nyaman; (2)
thumbnail muat gambar ukuran real — berat; (3) minta tag foto (tanggal, koordinat).
Plus klarifikasi: "kosongkan data" = hapus data **contoh/tes** biar mulai dari 0.

**Keputusan foto**:
- Saat upload: `sharp` bikin thumbnail webp ≤480px (disimpan `thumbnailKey`),
  `exifreader` baca `DateTimeOriginal` + GPS → `exifTakenAt`/`exifGpsLat/Lng`,
  simpan dimensi. (dep baru: `sharp`, `exifreader` sudah ada.)
- Komponen `PhotoGallery` (client): grid thumbnail kecil (ringan) + **lightbox
  in-page** (bukan tab baru), navigasi ←/→/Esc, tag EXIF (tanggal + koordinat +
  link Google Maps). Dipakai di: detail laporan, daftar laporan, lapor harian, peta.
- Helper `buildPhotoViews()` presign thumb+full sekaligus. Foto lama tanpa
  thumbnail fallback ke full.

**Keputusan reset**: dua mode di Diagnostik (super_admin):
- **Reset penuh — mulai dari nol** (konfirmasi `RESET SEMUA`): TRUNCATE CASCADE
  semua tabel isi; TETAP hanya `users` + `organizations`. Cara perhitungan
  kurva-S/jadwal = kode → otomatis tetap. Untuk mulai input data real.
- **Kosongkan operasional** (lama, `KOSONGKAN`): hapus laporan/foto/biaya saja,
  master tetap.

**Belum**: verifikasi EXIF/GPS otomatis (geofence), thumbnail untuk foto lama
(baru berlaku untuk upload baru), reverse-geocode koordinat→nama tempat.

---

## 040 · 2026-07-13 · Pengadaan = alur proyek: entitas Prospek → Kontrak

**Konteks (user)**: "pengadaan itu alur administrasi tiap proyek yang mau dipantau
progresnya". Buat calon kontrak → dijalankan → berkontrak (HPS pokja/PPK → nilai
final) → adendum. Atur alur UI/UX dari awal.

**Keputusan user**: (1) unit = paket, tapi dokumen diproses bersama sekaligus untuk
beberapa desa; (2) **Prospek entitas terpisah** (bukan Contract status draft).

**Implementasi (slice 1)**:
- `Prospek` (+ `ProspekLokasi`): paket tender sebelum tanda tangan — `hpsValue`,
  `stage` (identifikasi→undangan→penawaran→negosiasi→penetapan / jadi_kontrak /
  batal), desa target (draft, belum jadi Location). `Contract` + `hpsValue` +
  `prospekId`. Migrasi `20260713040000_prospek`.
- `/pengadaan/prospek/baru` (form + desa dinamis), `/pengadaan/prospek/[id]`
  (pipeline tahap + konversi). `convertToContract`: upsert Contractor + buat
  Contract (nilai final, bawa HPS) + Location per desa (slug unik, stage=kontrak)
  + tandai prospek jadi_kontrak. Terverifikasi E2E.
- `/pengadaan` tampilkan Prospek berjalan + tombol "Prospek baru", di atas
  funnel/grid per-lokasi lama (belum dibongkar).

**Belum (slice berikut)**: Alur Administrasi 45-milestone pindah ke level paket +
sub-baris per-desa; timeline adendum (CCO tambah/kurang → nilai baru); funnel
gabungan prospek+kontrak; hapus menu status per-lokasi lama kalau sudah tergantikan.

## UI · 2026-07-13 · Sidebar desktop sticky (fixed saat scroll)
Sidebar `lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto` — menu tetap terlihat
saat konten discroll.

## 041 · 2026-07-13 · Halaman detail Paket + timeline adendum
`/paket/[id]`: nilai HPS vs kontrak vs berjalan (kontrak + Σ valueDelta adendum),
riwayat/timeline adendum (ContractAmendment: CCO, ±nilai, ±hari, alasan) + form
Tambah Adendum (admin, append-only). Daftar lokasi paket + kelengkapan admin
(auto dari Document level kontrak/lokasi). `/paket` tambah section "Paket/kontrak
berjalan" → klik ke detail. Cap foto stamp (DECISIONS lanjut). Verifikasi: build/
typecheck/lint ✓; runtime E2E terblokir (sandbox pg+server down sesi ini).

## 042 · 2026-07-13 · Cetak halaman bersih (tanpa shell) + rapikan menu
Masalah: cetak Laporan Harian ikut mem-print sidebar/nav app (shell (app)/layout).
Solusi: komponen bersama `KkpDailyReport` + fetcher `getDailyReportView`; halaman
cetak KHUSUS di luar grup (app) → `/cetak/harian/[slug]/[date]` (root layout saja,
tanpa shell) + auto window.print. Tombol "Cetak/PDF" buka tab baru ke sana.
Menu: buang "Kontrak" dari nav (redundan dgn Paket; master tetap diakses via link
di Paket), urut ulang alur bisnis: Beranda·Peta·Paket·Lokasi·Lapor·Keuangan·
Pengguna·Diagnostik.

## 043 · 2026-07-13 · Lokasi jadi workspace ber-tab (IA) + harian input-first
Masalah (user): fitur lokasi (RAB, Dokumen, Administrasi, dll) terkubur sbg tombol
di BAWAH detail → kebanyakan klik, alur tak jelas. Solusi: `layout.tsx` untuk
`/lokasi/[slug]` render header lokasi + **tab bar** (Ringkasan·RAB·Kurva-S·Lapor·
Laporan Harian KKP·Dokumen·Administrasi) yang selalu tampil → 1 klik antar fitur.
Halaman anak dibersihkan (buang back-link & judul lokasi ganda). `LokasiTabs`
(usePathname, highlight aktif). Harian: buang preview form di layar (aneh — cetak
sudah generate PDF di /cetak), jadi input-first (editor) + tombol Cetak/PDF.
Belum: history deviasi/recovery (mingguan), laporan mingguan/bulanan — slice next.

## 044 · 2026-07-13 · Catatan deviasi & pemulihan jadi LOG (riwayat), bukan 1 field
User: deviasi bisa mingguan, mana history-nya? Model `DeviationNote` (locationId,
weekNo?, cause, recovery, createdBy, createdAt) append-only. Ringkasan lokasi:
form tambah catatan (admin) + timeline riwayat (newest first, tag Minggu N).
Field lama Location.deviationCause/recoveryPlan ditinggalkan (tak dipakai UI lagi).

## 045 · 2026-07-13 · Laporan Mingguan & Bulanan (generate on-the-fly, format KKP)
`getPeriodReport(slug, kind, n)` agregasi periode dari data harian + kurva-S +
deviasi: rentang tanggal, progres kumulatif (rencana/realisasi/deviasi di titik
periode), realisasi item periode, catatan kendala periode. Komponen
`KkpPeriodReport` (cover KKP + ringkasan + TTD). Tab "Mingguan/Bulanan" di
workspace lokasi (selector jenis+nomor) + halaman cetak bersih
`/cetak/periodik/[slug]/[kind]/[n]`. Tak butuh tabel WeeklyReport/MonthlyReport —
di-generate dari sumber. AutoPrint dishare `components/knmp/auto-print`.

## 046 · 2026-07-13 · Prospek jadi workspace administrasi SEJAK tender
User: dokumen (undangan, penawaran/RAB-HPS, dst) harus bisa diinput sejak prospek,
bukan nunggu jadi kontrak; nama paket editable. Document + `prospek_id` (migrasi).
Prospek detail: ProspekEdit (ubah nama/HPS/dll), Alur Administrasi 45-milestone
tampil di depan (auto ✓ dari dokumen prospek), ProspekDocUpload (unggah dokumen
tender), daftar dokumen. Saat convertToContract, dokumen prospek di-link ke kontrak.
Actions: updateProspek, uploadProspekDocument.

## 047 · 2026-07-13 · Peta di-optimalkan (ala area-manager Cloudflare)
User: peta banyak frame/area terbuang; perlu search highlight + filter area manager.
Redesign peta-map: dua-pane — panel kiri (cari lokasi/kabupaten, filter Area=provinsi
+ status, daftar lokasi) + peta full-height (calc(100vh-130px)). Klik lokasi (list
atau titik) → flyTo + marker di-highlight (ring navy, radius besar) + panel detail.
Buang PageHeader besar di halaman peta (hemat ruang).

## 048 · 2026-07-13 · Tahap pengadaan OTOMATIS dari dokumen (bukan manual)
User: tahap jangan dipilih manual — sistem baca dari dokumen yang terupload.
- prospek: `deriveStageFromDocs` (undangan/ba_penjelasan→undangan, penawaran→
  penawaran, ba_negosiasi→negosiasi, sppbj/penetapan→penetapan). `uploadProspekDocument`
  recompute + update stage otomatis; tahap jadi stepper read-only + Batalkan.
- urutan prospek: UNGGAH dokumen dulu, baru PROGRES alur administrasi.
- HPS bisa diisi saat unggah dokumen aanwijzing/penawaran (field hpsValue di form).
- paket detail: `deriveDocStage` → "Tahap saat ini (dari dokumen)" (min kontrak).
`updateProspekStage` manual dihapus dari UI; ganti `cancelProspek`.

## 049 · 2026-07-13 · RAB pre-PPN + warning nilai kontrak ≠ RAB
User: harga RAB/HPS belum termasuk PPN 11%; nilai kontrak yg tak sesuai RAB harus
warning. Import tetap ambil nilai asli (pre-PPN, benar). Detail lokasi Ringkasan RAB
tampilkan: nilai RAB (pre-PPN) + PPN 11% + Nilai RAB+PPN. Banner warning kalau
|nilai kontrak − (RAB+PPN)| > 0.1% (mis. kontrak = RAB tanpa PPN → flag selisih).

## 050 · 2026-07-13 · Kunci anti-input-ganda per item laporan
User: 1 item bisa diinput 2x (masing2 50 dari rencana 50), dua-duanya di-approve →
volume ganda 100. Fix best-practice: item TIDAK boleh punya >1 laporan belum tuntas.
`submitDraftItem` blokir kalau ada draft state draft_mandor/draft_sm/approved untuk
item itu ("selesaikan dulu setujui/tolak"). Kumulatif juga hitung sent+approved
(bukan sent saja). Cegah realisasi > 100% & double count.

## 051 · 2026-07-14 · REBUILD TOTAL — arsitektur, schema, stack (menggantikan banyak keputusan lama)
User meminta rebuild total MARLIN (master prompt). Keputusan payung — detail di docs/rebuild/*:
- Lifecycle dikonsolidasi: ProspekStage + ProcurementStage + DocumentStage → SATU
  `PackageStage` (prospek→tender→penetapan→kontrak→pelaksanaan→serah_terima→selesai|batal)
  + `LocationStatus` fisik (persiapan→berjalan⇄terhenti→selesai→pho→pemeliharaan→fho).
  Stage disimpan + histori append-only; dokumen = bukti, TIDAK memindah stage otomatis
  (meng-override 048 untuk transisi stage; auto-derive tetap dipakai utk SARAN milestone).
- Laporan harian disatukan: DailyReport (uniq lokasi+tanggal) + item volume + tenaga/
  material/alat/cuaca (menggantikan DailyReport/DailyReportItem/DailyLog terpisah).
  Workflow draft→dikirim→perlu_koreksi→disetujui→final; koreksi mengedit report yang sama;
  reportDate = tanggal kerja (fix bug tanggal-approve); anti-double kini constraint DB
  (uniq report+lineage; meng-upgrade 050 dari app-level ke DB-level).
- RAB: RabCategory/RabSubcategory/RabItem triple-parent → `RabNode` satu tabel
  (kind kategori|sub|grup|item) + `lineageKey` path stabil (ganti lineageId uuid).
  Semantik revisi snapshot + carry-over (023) dipertahankan.
- Keuangan snapshot manual (036) DIHAPUS → transaction-based: BudgetLine, Commitment,
  Expense, Invoice+PaymentOut, OwnerBilling+Disbursement; agregat selalu derived.
- Auth: next-auth v5 beta DIBUANG (beta permanen) → session DB custom (argon2id,
  revocable, tokenVersion, rate limit login, mustChangePassword). Authorization
  capability-based (PERMISSION_MATRIX.md) — `canManageUsers` tidak lagi jadi gate
  keuangan/kontrak/RAB (meng-override pemakaian lama).
- Stack: Next 16.2.10, React 19.2.7, Prisma 7.8.0 + adapter-pg, Tailwind 4.3.2 stable,
  Zod 4, TS 5.9.3 (TS7 ditahan), Node 24 LTS, pnpm 11, AG Grid Community 36 (grid utama),
  semua dependency pinned exact + license audit CI. ESLint ditahan di 9.39.5
  (eslint-config-next belum kompatibel ESLint 10).
- Deploy: Dockerfile multi-stage (node:24-bookworm-slim, non-root, tini, standalone)
  menggantikan Nixpacks; CI GitHub Actions lengkap.
- Model dihapus: Prospek/ProspekLokasi (→Package), Device, OtpCode, SyncQueue,
  ScheduledMilestone, WeeklyReport, MonthlyReport, DailyLog*, CostEntry, DeviationNote
  (→Issue/RecoveryAction), kolom keuangan snapshot Location.
- Migration dev lama dihapus → baseline migration baru; DB dev di-reset; seed baru
  deterministik dgn angka diturunkan dari Σ leaf RAB (total kategori JSON lama korup).
- Ditunda sadar (dicatat di REBUILD_PLAN/laporan akhir): peta Leaflet, PWA offline penuh
  (localStorage draft + idempotency dulu), PR/PO/receiving granular, WA-text intake.

## 052 · 2026-07-15 · Kurva-S evaluasi kontinu (mulai 0, bentuk-S) + saran rencana mingguan otomatis

Menindaklanjuti keputusan Hery: algoritma kurva-S lama (akumulasi delta smoothstep
per minggu, mulai dari minggu-1 tiap jendela) menghasilkan kurva yang **tidak mulai
dari 0** (minggu-1 sudah ~3%), kurang rapi, dan bentuk-S lemah.

**Perubahan (mengganti bagian "formula terverifikasi JANGAN diubah" di 051 untuk
scurve — dengan test properti, bukan paritas nilai):**
- `scheduleItems`/`generateScurve` kini **evaluasi KONTINU**: kumulatif(t) =
  Σ bobot_i × smoothstep((t − start_i)/(end_i − start_i)), dievaluasi pada
  t = minggu/totalWeeks untuk minggu 1..n. Dijamin: t=0 → 0 (kurva mulai dari 0),
  t=1 → 100, monotonik, bentuk-S alami (awal landai, tengah curam, akhir landai).
  Bobot = amount/grand (cost-weighted); jendela = trade (urutan dependensi lapangan,
  tak berubah). Storage tetap minggu 1..n; chart meng-anchor titik minggu-0 = 0%.
- Test paritas lama (panjang, monotonik, akhir 100) tetap hijau + properti baru
  (mulai landai < porsi linear, laju tengah > awal/akhir).

**Fitur baru — saran rencana mingguan otomatis (`lib/plan/suggest*.ts`):**
- Dari fraksi rencana per-trade vs realisasi nyata: target minggu ini = kenaikan
  rencana minggu ini + tertinggal (rencana s/d minggu lalu − realisasi), clamp ke
  sisa volume. Bila deviasi negatif → saran otomatis **mengejar ketertinggalan**;
  bila tepat jadwal → beban normal. Diurutkan dampak rupiah (bobot ekstra utk kejar),
  prioritas 1..9. Tetap bisa diedit/dibuat manual (tombol "Terapkan" mengisi rencana).
- Inti murni `suggest-core.ts` (uji unit), lapisan DB `suggest.ts`, aksi
  `getWeeklySuggestions`/`applyWeeklySuggestions` (capability weekly_plan.manage + audit).

## 053 · 2026-07-16 · Penanda tangan dokumen KKP di kontrak + realisasi kurva-S per periode

- **Penanda tangan** (PPK, Konsultan Pengawas, Penyedia/Pelaksana) disimpan di
  `Contract` (satu kontrak → N lokasi, penanda tangan sama). 6 kolom opsional:
  `ppkName`/`ppkNip`, `supervisorName`/`supervisorFirm`,
  `contractorSignerName`/`contractorSignerTitle`. Diisi saat konversi kontrak
  **dan** bisa diubah kapan saja lewat form di tab Kontrak (pergantian personel) —
  aksi `updateContractSignatories` (capability `contract.manage` + audit).
  Dirender di blok TTD laporan kurva-S (hal-1), mingguan/bulanan (hal-2), dan
  harian. Kosong → baris titik-titik seperti sebelumnya.
- **Realisasi kurva-S per periode**: laporan "Minggu ke-n" adalah snapshot s/d
  minggu n. Seri realisasi/deviasi hal-1 dibatasi `cutoffWeek = min(minggu
  berjalan, minggu akhir periode)` — bukan lagi selalu s/d hari ini. Baris Rencana
  tetap penuh (garis target). Sebelumnya kolom realisasi/deviasi ikut terisi sampai
  minggu berjalan walau membuka laporan minggu-1.

## 054 · 2026-07-17 · Kontrak simpan masa pelaksanaan (hari); tanggal mulai dari SPMK; lokasi + kecamatan

- **Kontrak tidak lagi memaksa tanggal mulai/selesai.** Pekerjaan mulai saat
  **SPMK**, bukan saat tanda tangan kontrak. `Contract` kini menyimpan
  `durationDays` (masa pelaksanaan hari kalender, wajib) sebagai tulang punggung
  jadwal; `startDate`/`endDate` **nullable** — baru terisi saat SPMK.
- **Tanggal SPMK diinput di langkah "Mulai Pelaksanaan"** (kontrak → pelaksanaan):
  `startDate = SPMK`, `endDate = SPMK + durationDays`. Sebelum SPMK: jadwal
  bentuk kurva-S tetap bisa dari `durationDays` (relatif), tapi pemetaan kalender
  ("minggu berjalan") & laporan periodik belum aktif ("menunggu SPMK").
- `contractDaysFor` & `masaPelaksanaanHari` kini dari `durationDays` (bukan
  end−start). `getPeriodBounds` mengembalikan null bila SPMK belum terbit.
  Backfill migrasi: `durationDays = end_date − start_date` utk kontrak lama.
- **Lokasi + kecamatan**: `Location.district` (opsional) ditambah di form input
  lokasi & tampil di alamat laporan KKP (`village, Kec. district, regency`).

## 055 · 2026-07-17 · Nilai RAB = HARGA NEGOSIASI (bukan HPS) via deteksi header

- RAB KKP sering punya DUA blok harga: HPS (NILAI HPS/JUMLAH) lalu HARGA
  NEGOSIASI (HARGA NEGOISASI/JUMLAH HARGA) hasil klarifikasi. **Nilai kontrak =
  harga negosiasi** — itu yang dipakai parser bila ada (fallback HPS bila tidak).
- Parser kini **mendeteksi kolom dari baris header** (`detectColumns`), bukan
  hardcode posisi, karena layout bervariasi antar file. Sebelumnya selalu baca
  kolom JUMLAH (HPS) → rekap lebih tinggi dari kontrol negosiasi lapangan.
- Contoh RAB_Nyamplung: dgn kolom negosiasi + fix kategori-tanpa-judul (054/ini),
  semua 10 kategori cocok persis dgn rekap HARGA NEGOSIASI (≤2 rupiah, pembulatan
  per-item). Grand total 2.381.955.611 (nego) vs 2.499.158.269 (HPS).

## 056 · 2026-07-17 · Pembuatan user berjenjang + flag pembuat (createdById)

- Capability baru `user.create` (beda dari `user.manage` yang penuh). PM & Site
  Manager mendapatnya. Hierarki `creatableRoles`: PM → Site Manager + Mandor;
  Site Manager → Mandor; peran manajemen penuh → semua. Divalidasi server
  (`canCreateRole`), bukan hanya UI.
- `User.createdById` (self-relation, nullable) mencatat pembuat tiap akun —
  ditampilkan "Dibuat oleh" di daftar. Akun seed/awal = null.
- Pembuat terbatas (bukan user.manage) di halaman Pengguna: hanya melihat akun
  yang IA buat (read-only, tanpa aksi kelola), form peran dibatasi
  `creatableRoles`, dan penugasan lokasi dibatasi lokasi yang IA akses.
- Menu "Pengguna" kini muncul utk pemilik `user.create` (bukan hanya user.manage).

## 057 · 2026-07-18 · Algoritma penjadwalan kurva-S per-lokasi (cost-based duration + presedensi CPM)

- **Masalah**: jendela waktu tiap trade dulu TETAP (di-tebak pakar, sama untuk
  semua lokasi). Bobot biaya sudah per-lokasi (amount/grand), tapi *penjadwalan*
  (kapan tiap trade mulai/selesai) tidak menyesuaikan komposisi lokasi.
- **Keputusan**: jendela `[start,end]` tiap trade dihitung PER-LOKASI dari
  komposisi bobotnya sendiri (`computeTradeWindows` di `src/lib/scurve/generate.ts`),
  deterministik (BUKAN panggil AI saat runtime). Dua prinsip, hasil riset
  penjadwalan konstruksi + korpus 15 RAB KNMP (docs/rab-analysis):
  1. **Presedensi (CPM)** — tiap trade punya band `[bandStart,bandEnd]` = amplop
     paling awal boleh mulai … paling akhir boleh selesai. Mengunci urutan
     lapangan (persiapan→tanah→pondasi→struktur→dinding/atap→MEP→finishing→
     landscape) dengan tumpang-tindih realistis (start-to-start lag).
  2. **Durasi berbasis biaya** (*cost-based / cost-loaded duration*) — trade yang
     menyerap porsi biaya lebih besar menempati rentang waktu lebih panjang.
     `dur = minDur + (bandWidth−minDur)·min(1, share/0.32)`. Referensi: CMU
     PMbook Construction Planning; praktik kurva-S RAB ID (bobot=biaya/total,
     sebar sepanjang durasi item).
  3. **Anchor** posisi dalam band: front (persiapan/tanah/pondasi), tail
     (finishing/landscape), center (struktur/dinding/atap/mep/sarana_luar).
- **Efek**: lokasi struktur-berat → jendela struktur melebar (kurva curam di
  tengah); lokasi MEP/finishing-berat → kurva mundur (back-loaded). Finishing =
  ekor panjang alami (minDur 0.30) supaya tak ada jeda datar setelah struktur.
- **Konsistensi**: jendela yang sama dipakai baseline (`scheduleItems`), saran
  rencana mingguan (`suggest-core` — bobot trade dari Σ volume×harga), dan sheet
  KKP (`kkp-sheet` — bobot trade dari Σ bobot item). Sifat DECISIONS 052 dijaga:
  mulai 0, akhir 100, monoton, bentuk-S. `TYPICAL_TRADE_MIX` (share korpus)
  jadi jendela default bila konteks bobot lokasi belum ada.

## 058 · 2026-07-23 · Kegiatan & Dokumentasi Lapangan (non-pekerjaan) — entitas terpisah

- **Kebutuhan**: dokumentasi FOTO kegiatan non-pekerjaan antara kontrak → SPMK →
  awal fisik (rapat PCM, pengukuran/uitzet, MC-0, sosialisasi, mobilisasi, foto
  kondisi 0%). Bukan progres volume RAB, sering terjadi SEBELUM SPMK, dan bisa
  banyak per hari.
- **Keputusan (Opsi B)**: entitas baru ringan `FieldActivity` (kegiatan lapangan)
  + `Photo.activityId` (nullable) supaya reuse pipeline foto (cap GPS/waktu +
  verifikasi + dedup sha256) yang selama ini hanya menempel ke laporan harian.
  - Alternatif ditolak: (A) numpang `DailyReport` — mengotori model progres
    volume (pola yang dihindari DECISIONS 051) & terbentur uniq(lokasi,tanggal);
    (C) hanya Document Center/Milestone — foto jadi file satu-per-satu tanpa
    cap/verifikasi, UX berat utk mandor.
- **Model**: `FieldActivity(locationId, activityDate @db.Date, type, title,
  notes?, participants?, gps?, status, createdById, finalizedBy/At)`. Enum
  `FieldActivityType` (rapat_pcm/pengukuran_uitzet/mc0/sosialisasi/mobilisasi/
  dokumentasi_0/lainnya) & `FieldActivityStatus` (draft/final).
- **Workflow RINGKAS** `draft → final` (dokumentasi, bukan angka yg perlu
  verifikasi berjenjang). Final = arsip: tak bisa tambah/hapus foto/hapus
  kegiatan. Bebas dari SPMK/minggu.
- **Authz**: capability `field_activity.manage` (Mandor, Site Manager, PM, Area
  Manager + peran manajemen penuh). View mengikuti `location.view`. Setiap mutasi
  `requireCapability` + `requireLocationAccess` + `audit`.
- **UI**: tab "Kegiatan Lapangan" di workspace lokasi (mobile-first) — form catat
  (jenis, tanggal, judul, catatan, peserta, foto capture) + daftar kartu dgn
  galeri foto; draft punya aksi tambah-foto/finalkan/hapus.
- Melengkapi (bukan menduplikasi) Document Center & milestone KKP; integrasi ke
  keduanya bisa menyusul.

## 059 · 2026-07-23 · Patch keamanan: next 16.2.10→16.2.11 + override sharp/fast-uri

- CI gate `pnpm audit --prod --audit-level high` mulai gagal karena advisory
  BARU dipublikasikan (bukan akibat perubahan kode) — repo-wide, bukan spesifik
  fitur.
- **next 16.2.10 → 16.2.11** (patch dalam minor sama): menutup 6 advisory high
  (middleware bypass, DoS Server Actions, SSRF rewrites, dst.). Tetap Next 16
  pinned-exact, hanya patch keamanan.
- **overrides transitif** di `pnpm-workspace.yaml` (pnpm 11 tak lagi baca
  `pnpm.overrides` di package.json): `sharp: 0.35.3` (dedupe salinan next→sharp
  ke versi patched libvips, sama dgn dep langsung) & `fast-uri: >=3.1.4` (patch
  host-confusion, transitif Prisma).
- Hasil: `pnpm audit --prod --high` bersih (sisa 4 moderate < gate). typecheck /
  lint / unit 80 / build produksi hijau. Tanpa perubahan perilaku aplikasi.

## 060 · 2026-07-23 · Master lokasi awal (impor xlsx) + jalur cepat admin (bypass) buat proyek

- **Master data awal** (dari `lokasi_awal.xlsx`): tabel `MasterLocation` — katalog
  lokasi BELUM terikat paket (prov/kab/kec/desa + lat/lng + hint `candidateVendor`).
  Karena `Location` wajib punya paket, katalog dipisah; lokasi riil dibuat saat
  dipetakan ke paket. 14 perusahaan unik → master `Vendor` (TANPA FK ke lokasi;
  calon penyedia hanya hint teks). Data di-embed `src/lib/seed/lokasi-awal.data.ts`
  (73 baris), di-seed idempotent via `seedMasterLocations` di `runDemoSeed`.
- **Bypass (jalur cepat admin)**: capability `package.bypass` (hanya Super Admin
  & Program Director). `createDirectProject` membuat Paket langsung di tahap
  **kontrak** (`isBypass=true`) + Contract + Location riil dari `MasterLocation`
  terpilih (ditandai `assignedLocationId`), lewati proses pra-kontrak
  (prospek→tender→penetapan). Histori stage null→kontrak + `audit`. Semua dalam
  satu transaksi (mesin transisi tetap dihormati untuk lanjutan; bypass hanya
  titik-masuk). Dokumen pengadaan menyusul; **mulai kerja tetap lewat SPMK**.
- Field wajib: nama paket, vendor (master/baru), nomor kontrak, nilai, PPN
  (default 11), tgl TTD, masa pelaksanaan (hari), ≥1 lokasi katalog. Paket
  bertanda **"Bypass — dokumen menyusul"** di header + note + audit
  (`package.bypass_create`).
- UI: menu `/paket/bypass` (tombol "Buat Cepat (Bypass)" di header /paket, hanya
  pemilik `package.bypass`) — pilih lokasi dari katalog (filter + grup provinsi).

  - **Mitigasi lokasi ganda (production)**: katalog master bisa memuat lokasi yang
    sudah ada sebagai Location riil (mis. dibuat lewat alur normal). `getAvailableCatalog`
    (`src/lib/master-location.ts`) menyembunyikan master yang kunci alaminya
    (prov|kab|kec|desa) sudah ada sebagai Location riil; `createDirectProject`
    juga menolak master yang bentrok saat instansiasi (jaring pengaman). Katalog
    tampil dgn catatan "N lokasi disembunyikan karena sudah ada".

## 061 · 2026-07-23 · Impor batch katalog lokasi (xlsx) — jalur produksi & lanjutan

- Menjawab kebutuhan "master lokasi awal masuk production": dibuat **jalur impor
  batch** (bukan hanya seed dev) supaya admin bisa memuat katalog di production
  dan batch lokasi berikutnya lewat UI.
- `parseMasterLocationXlsx` (`src/lib/master-location/import.ts`): deteksi baris
  header + kolom by keyword (Provinsi/Kabupaten/Kecamatan/Desa/Latitude/Longitude/
  Calon Penyedia) — toleran urutan & kapitalisasi. Wajib min: provinsi, kabupaten,
  desa.
- Actions (`master-location/actions.ts`, gate `package.bypass`): `previewMasterImportAction`
  (parse + ringkasan tanpa tulis DB: baru/diperbarui/sudah-ada-riil/vendor baru) &
  `commitMasterImportAction` (upsert MasterLocation idempotent + ingest Vendor unik
  + audit `master_location.import`). Dedupe per kunci alami dalam file.
- UI `/paket/katalog` (SA+PD): KPI (total/tersedia/terpakai/sudah-ada) + form impor
  (pratinjau → simpan, File ditahan di klien) + tabel isi katalog. Ditaut dari
  header /paket & halaman bypass. Modul `src/lib/master-location.ts` dipindah ke
  `src/lib/master-location/queries.ts` (jadi direktori).
- Seed dev tetap memuat katalog otomatis (embedded); impor idempotent → aman
  dijalankan ulang di dev maupun production.

## 062 · 2026-07-23 · Manajemen & gabung master perusahaan (vendor)

- Impor `upsert` vendor by nama PERSIS → ejaan beda ("CV Permata" vs "CV. Permata")
  jadi duplikat. Dibuat alat pembersih di `/paket/vendor` (gate `contract.manage`
  = SA+PD).
- `listVendorsWithUsage` + `duplicateGroups` (deteksi via `normalizeVendorName`:
  buang prefix CV/PT/UD/… & non-alfanumerik) menandai kemungkinan duplikat.
- `mergeVendorsAction(from→to)`: alihkan SEMUA kontrak & komitmen dari `from`
  ke `to`, lalu hapus `from` (satu transaksi, konfirmasi, audit `vendor.merge`).
  `deleteVendorAction`: hapus hanya bila 0 kontrak & 0 komitmen. `candidateVendor`
  (master lokasi) & `candidateVendorName` (paket) berupa teks — tak terpengaruh.
- UI: KPI (total/duplikat/grup) + tabel vendor (jumlah kontrak/komitmen) +
  "Gabung ke…" per baris + Hapus (hanya tak terpakai). Tautan header /paket.

## 063 · 2026-07-23 · Nama paket vs judul kontrak (workTitle) + koreksi kontrak super-admin

- **Pisah nama**: `Package.name` = label PENDEK (daftar/tampilan); judul resmi
  panjang disimpan `Contract.workTitle` (untuk dokumen). Form Bypass & konversi
  kontrak menambah field "Nama pekerjaan resmi (opsional)". Header paket
  menampilkan "Pekerjaan: …" bila ada. Tabel paket: nama di-truncate + tooltip.
- **Koreksi kontrak (super_admin)**: capability `contract.edit` (HANYA super_admin;
  program_director dikecualikan). `editContractAction` membetulkan SEMUA field —
  nama paket, workTitle, nomor (uniq), nilai, PPN, tgl TTD, `durationDays`,
  `startDate`(SPMK) → `endDate` otomatis. **Berbeda dari adendum** (perubahan resmi
  append-only); ini alat koreksi data.
- **Auto-recompute**: bila `durationDays`/`startDate` berubah → `regenerateBaseline`
  per lokasi. Realisasi tetap nyambung by lineage. UI: kartu "Koreksi kontrak
  (Super Admin)" di halaman kontrak.
- Alasan: setelah refactor SPMK (054) tak ada jalur memperbaiki kontrak yang sudah
  diset (SPMK sekali pakai, durasi tak bisa diedit) — ini menutup celah itu.

## 064 · 2026-07-23 · Ganti judul kategori RAB (perbaiki kategori tanpa judul)

- Beberapa file RAB punya kategori TANPA baris judul → parser membuat placeholder
  "PEKERJAAN (kategori … — judul tidak ada di file)" + warning "mohon lengkapi".
  Selama ini tak ada cara mengisinya. Ditambah edit inline judul kategori di tab
  RAB (ikon pensil), gate `rab.manage` + `requireLocationAccess` + audit
  (`rab.rename_category`). Hanya metadata nama (kind=kategori) — tak menyentuh
  nilai/lineage → baseline tak berubah.

## 065 · 2026-07-23 · Hapus foto kegiatan lapangan + buka kembali (final→draft)

- Kebutuhan: menghapus foto yang terlanjur diunggah (mis. cap perusahaan salah
  sebelum fix 063). Kegiatan **draft** kini bisa hapus foto per item; **final**
  dikunci dulu (buka kembali).
- `removeActivityPhotoAction(photoId)`: gate `field_activity.manage` +
  `requireLocationAccess`, hanya bila kegiatan masih `draft`, hapus baris `Photo`
  lalu objek R2 (`r2Key`+`thumbnailKey`, best-effort via `deleteR2Keys`).
- `reopenActivityAction`: `final → draft` (gate `field_activity.manage`, audit
  `field_activity.reopen`) → alur koreksi: Buka kembali → hapus foto salah →
  tambah foto (cap benar) → Finalkan lagi.
- `deleteActivityAction` sekaligus bersihkan objek R2 semua fotonya (dulu hanya
  hapus baris DB → orphan). `PhotoGallery` dapat prop `canDelete`/`deleteAction`
  (tombol hapus per thumbnail, `window.confirm`), dipakai halaman kegiatan.
- Foto laporan harian (DailyReport) TIDAK termasuk — hanya kegiatan lapangan.

## 066 · 2026-07-23 · Transisi stage paket: konfirmasi wajib, guard serah terima 100%, mundur (koreksi)

- **Masalah**: tombol transisi stage (mis. "Tandai Serah Terima") jalan hanya
  dengan SATU klik — mudah salah pencet, dan tak ada jalan mundur (mesin transisi
  satu arah). Serah terima juga bisa dilakukan walau progress belum 100%.
- **Konfirmasi 2 langkah**: `AdvanceStageButton` kini klik → panel konfirmasi
  ("Yakin ubah tahap ke …?" + tombol Ya/Batal). Prop `warn` menampilkan peringatan
  mencolok pada langkah konfirmasi.
- **Guard serah terima**: `advanceStage(...,"serah_terima")` menolak bila progress
  agregat < 99.95% (= "100.0%" pada formatPct 1 desimal). Progress dihitung dari
  realisasi RAB aktif semua lokasi (`aggregateProgressPct`). UI juga memberi warn
  pra-konfirmasi bila belum 100%.
- **Mundur (koreksi)**: `revertStage(packageId, reason)` mundur SATU langkah aman
  via `revertTargetFor` — hanya {tender→prospek, penetapan→tender,
  serah_terima→pelaksanaan, selesai→serah_terima}. Batas berkontrak
  (kontrak↔penetapan, pelaksanaan↔kontrak) DIKECUALIKAN karena menyangkut
  Contract/SPMK/status lokasi — koreksinya lewat Koreksi Kontrak (063) / Batalkan.
  Alasan wajib (≥5 char), tercatat di `PackageStageHistory` (note "Mundur (koreksi):")
  + audit `package.revert`. Gate `prospect.manage` (sama seperti menaikkan).
- UI: tombol "Mundurkan ke <tahap>" di kartu "Langkah berikutnya" bila ada target
  mundur. Test unit `tests/unit/lifecycle.test.ts` menjaga invarian arah & satu-langkah.

## 067 · 2026-07-23 · Lampiran dokumen kegiatan lapangan (ringkas, di luar Document Center)

- Kebutuhan: kegiatan lapangan sering perlu lampiran non-foto (notulen, undangan,
  berita acara, daftar hadir). Sebelumnya hanya foto.
- **Pilihan desain**: model ringkas `FieldActivityAttachment` sejajar `Photo`
  (menempel ke kegiatan) — BUKAN `Document` formal. Alasan: kegiatan sengaja
  ringkas & informal (058); memaksa taksonomi phase+type KKP + milestone
  auto-link + dedup-per-org (Document Center) tidak cocok untuk dokumentasi harian.
- Model: `field_activity_attachments` (r2Key unik, fileName, mimeType, bytes,
  sha256, uploadedById). Terima MIME sama dgn Document Center (PDF/DOCX/XLSX/
  JPG/PNG/WebP), maks 15 MB, dedup **per-kegiatan** (bukan per-org).
- Actions: `addActivityAttachmentsAction` (draft-only, best-effort per berkas),
  `removeActivityAttachmentAction` (draft-only, hapus DB + objek R2), audit
  `field_activity.attachment_add`. `deleteActivityAction` kini juga bersihkan R2
  lampiran (bukan cuma foto). Reopen (final→draft) mengizinkan koreksi lampiran.
- Unduh: route `/api/kegiatan/lampiran/[id]` — auth + `hasLocationAccess` → presign
  R2 120 dtk (pola sama seperti `/api/documents/[id]`).
- UI: tombol "Tambah dokumen" di aksi draft + daftar lampiran (unduh + hapus saat
  draft) di kartu kegiatan. Foto & dokumen resmi (Document Center) tidak berubah.

## 068 · 2026-07-23 · Hitung ulang kurva-S: idempotent + konfirmasi (bukan spam versi)

- Temuan user: "Hitung ulang" ditekan berulang membuat baseline baru terus walau
  hasilnya identik, dan langsung aktif sekali klik tanpa konfirmasi.
- `regenerateBaseline` kini IDEMPOTENT: hasil hitung dibandingkan dgn baseline
  aktif (revisi RAB, contractDays, seluruh titik ±0.005) — identik ⇒ kembalikan
  baseline aktif dgn flag `unchanged`, TANPA versi baru & tanpa audit palsu.
  Berlaku juga utk pemanggil lain (aktivasi revisi, koreksi kontrak, impor).
- `RecalcBaselineButton` dua langkah (klik → panel konfirmasi) + teks jelas
  bahwa edit manual pada baseline aktif akan ditimpa dan versi lama tersimpan
  di "Riwayat baseline" (kartu paling bawah halaman Progress — sudah ada sejak
  awal, pesan sukses kini menunjuk ke sana).
- Catatan asesmen (belum dibangun): editor manual saat ini mengedit %-kumulatif
  mingguan (output), bukan penjadwalan per pekerjaan (input). Usulan lanjutan =
  editor jadwal per kategori (bobot tetap dari RAB — prinsip derived; yang
  diatur manual jendela minggu mulai–selesai per kategori) → kurva dihitung
  otomatis. Menunggu keputusan user.

## 069 · 2026-07-23 · Editor jadwal per pekerjaan (kurva-S standar sipil) + pulihkan/banding riwayat baseline

- **Riset** (STEKOM, Lab MRK Unand, praktik kurva-S RAB Indonesia): format standar
  = tabel pekerjaan × bobot (nilai ÷ total, DERIVED) × jendela waktu (barchart);
  bobot dibagi terhadap durasi per periode (umumnya rata per minggu), akumulasi
  vertikal per minggu → kumulatif → kurva S. Bentuk S muncul dari tumpang-tindih
  antar pekerjaan, bukan distribusi per aktivitas.
- **Editor jadwal per pekerjaan** (kartu baru di Progress, utama di atas editor
  %-mingguan): baris = kategori RAB aktif, bobot % TERKUNCI (ubah bobot = revisi
  RAB/adendum — prinsip derived), input minggu mulai–selesai + bar gantt mini +
  pratinjau kurva langsung. `curveFromCategorySchedule` (pure, unit-tested):
  distribusi rata dalam jendela, clamp, monotonik, akhir 100.
- **Jadwal tersimpan**: model `BaselineScheduleItem` (baselineId, lineageKey,
  name, weightPct, startWeek, endWeek) — jadwal yang menghasilkan baseline ikut
  disimpan agar bisa dibuka & disesuaikan lagi (bukan cuma output). Jadwal awal
  bila belum ada: derivasi otomatis envelope trade-windows item per kategori.
- `saveCategorySchedule`: bobot dihitung ulang server dari RAB aktif (jendela
  saja yang dipercaya dari klien), validasi rentang, idempotent (identik ⇒ tanpa
  versi baru), audit `baseline.schedule`.
- **Riwayat baseline**: kartu jadi interaktif — centang versi (maks 4) → overlay
  kurva multi-garis satu grafik; tombol **Pulihkan** (konfirmasi 2 langkah) =
  salin versi lama menjadi versi BARU aktif (append-only, riwayat tetap linear;
  status versi lama tidak diubah), audit `baseline.restore`.

## 070 · 2026-07-24 · Penjadwalan konstruksi per-unit menggantikan trade-global (kurva + rekomendasi)

- **Masalah** (dari user, contoh rumah genset): penjadwalan lama mengelompokkan
  item per-trade GLOBAL selokasi → urutan antar-tahap DALAM satu bangunan tak
  terjamin (dinding bisa "mulai" sebelum pondasi unitnya karena meminjam jendela
  pondasi global bangunan lain). MEP juga tak dipisah (pasang kabel = pasang lampu).
- **Mesin baru** `src/lib/scurve/sequencing.ts` (Slice A): WBS per-unit (kategori
  RAB = bangunan/ruas) → deteksi tipe (gedung/jalan/marine/utilitas/lansekap/umum)
  → tiap item ke TAHAP ber-presedensi. MEP dipecah rough-in (kabel/konduit/
  instalasi tanam, dini) vs finish (lampu/armatur/sanitair, setelah cat).
  Pondasi<struktur<dinding; jalan: perkerasan setelah lapis pondasi, marka akhir.
  Deterministik + pure. Diuji terhadap korpus 15 RAB nyata (547 item): cakupan
  by-value ~83%, invarian hard-edge per-unit terpenuhi.
- **Slice B** — disambungkan:
  - `regenerateBaseline` & demo seed pakai `scheduleBySequence` (bukan scheduleItems).
  - `suggest-core` (rekomendasi mingguan) pakai tahap per-unit + **GERBANG
    PRASYARAT**: tahap penerus tak disarankan bila prasyarat KERAS di unit yang
    sama < 80% (mis. dinding rumah genset ditahan sampai pondasinya ≥80%).
  - `kkp-sheet` (kurva-S resmi KKP) & `deriveCategorySchedule` (editor manual)
    ikut memakai mesin baru → semua tampilan kurva konsisten satu sumban.
- Fungsi trade lama (scheduleItems/classifyTrade/computeTradeWindows/
  tradePlannedFraction) DITINGGALKAN app tapi disimpan+diuji (generate.ts) untuk
  generateScurve/categoryPlannedFraction lain; bisa dibersihkan kelak.
- **Batas jujur**: klasifikasi kata kunci (~17% jatuh ke "lainnya" jendela tengah
  low-risk); kategori = unit (bila satu kategori campur banyak bangunan, presisi
  turun); presedensi-template per-unit, BUKAN CPM antar-item eksplisit. Semua bisa
  diperbaiki bertahap (tabel + uji).

## 071 · 2026-07-24 · Header laporan: nama resmi + nilai per-lokasi; editor kurva-S collapsible

- **Nama pekerjaan** di laporan (KKP sheet, laporan periodik, export xlsx) memakai
  `Contract.workTitle` (nama resmi panjang), fallback `Package.name` — bukan nama
  pendek. (`packageName` di PeriodHeader kini = workTitle ?? name.)
- **Nilai** di header laporan diganti dari NILAI KONTRAK SELURUH PAKET →
  **"Nilai Fisik Lokasi"** = Σ RAB aktif lokasi itu (`PeriodHeader.locationValue`).
  Nilai kontrak paket multi-lokasi membingungkan pada laporan satu lokasi.
  Semua 3 tampilan (scurve-kkp-sheet, kkp-period-report, xlsx) diperbaiki.
  Laporan harian tak menampilkan nilai paket (aman).
- **UI**: primitive `CollapsibleCard` (native <details>, tanpa JS klien). Editor
  "Jadwal per pekerjaan" & "Penyesuaian halus %-mingguan" di halaman Progress kini
  terlipat default (klik header untuk buka) — mengurangi ruang terpakai.

## 072 · 2026-07-24 · Rekonsiliasi nilai kontrak (input) vs Σ RAB semua lokasi (halaman paket)

- Pertanyaan user: "Nilai kontrak berjalan" di ringkasan paket = INPUT (nilai
  kontrak + adendum), BUKAN jumlah lokasi. Sebelumnya tak ada tempat memverifikasi
  selisih input vs total RAB lokasi.
- Kartu baru "Rekonsiliasi" di halaman paket (bila berkontrak):
  - Kontrak berjalan (incl PPN) = input; Nilai dasar pra-PPN = kontrak ÷ (1+PPN);
    Σ RAB semua lokasi (pra-PPN, dari getLocationsProgress grandTotal); Selisih.
  - Banding pada basis PRA-PPN (kontrak incl-PPN vs RAB pra-PPN — konvensi uang).
  - StatusPill: teralokasi penuh (±1%) / ada selisih / belum semua lokasi ber-RAB.
  - Rincian per lokasi (details): RAB pra-PPN + % thd nilai dasar; tandai lokasi
    tanpa RAB. Menutup celah verifikasi alokasi kontrak↔RAB.

## 073 · 2026-07-24 · Alur normal: pilih vendor & lokasi dari master impor (bukan hanya manual)

- Keluhan user: di proses normal, perusahaan/lokasi yang sudah DIIMPOR tak bisa
  dipilih — hanya bisa ketik manual. Harusnya bisa tambah baru ATAU pilih yang ada.
- **Lokasi (pra-kontrak)**: `addTargetLocationsFromCatalog(packageId, masterIds[])`
  — buat lokasi target dari katalog MasterLocation (belum terpakai, tolak yang
  bentrok kunci alami), tandai master terpakai, prefill kandidat vendor paket bila
  seragam. UI: `CatalogLocationPicker` (cari + centang) di tab Lokasi, di atas form
  manual (manual jadi `<details>` "Atau isi manual"). Reuse getAvailableCatalog.
- **Vendor**: form Paket Baru "Kandidat vendor" kini `<input list>` + `<datalist>`
  nama vendor (dari listVendors) → bisa pilih perusahaan terimpor ATAU ketik baru.
  Konversi kontrak sudah punya dropdown vendor (existing/baru) — tak berubah.

## 074 · 2026-07-24 · Unggah dokumen langsung dari dalam paket (hapus round-trip)

- Keluhan user: unggah dokumen paket harus keluar ke Document Center → pilih paket
  lagi → upload. UX konyol.
- Tab **Dokumen paket** kini punya form unggah inline (`PackageDocUploadForm`,
  CollapsibleCard, default terbuka bila kosong): `packageId` sudah terisi otomatis,
  Fase + Jenis dokumen tetap taksonomi resmi, Jenis menyesuaikan Fase
  (`TYPES_BY_PHASE`), lokasi paket opsional. `uploadDocumentAction` kini juga
  revalidate `/paket/[id]/dokumen`. Tab lokasi sudah punya QuickUploadForm inline
  sejak awal. Document Center tetap ada untuk kelola lintas-paket.

## 075 · 2026-07-24 · Pembulatan RAB ke rupiah via apportionment (cocok Excel)

- Temuan user: total RAB pra-PPN di app (mis. 8.542.625.857) meleset ~7 rupiah dari
  Excel (8.542.625.850,38); beberapa lokasi bisa selisih ratusan rupiah. Lapangan
  ikut angka Excel.
- Akar: `flatten.ts` membulatkan TIAP baris `BigInt(Math.round(...))` lalu menjumlah
  (Σ round). Excel menjumlah nilai penuh lalu membulatkan sekali (round Σ). Beda
  urutan pembulatan → akumulasi (di file uji 822 baris berdesimal → +6,62 rupiah).
- Perbaikan: pembulatan TOP-DOWN via **apportionment (largest remainder / Hamilton)**.
  `apportion(exacts, target)`: tiap sibling dapat floor(eksak); sisa (target−Σfloor)
  rupiah dibagi +1 ke pecahan desimal terbesar (tie-break: urutan asli, sort stabil
  → deterministik/idempotent). Grand total = `round(Σ eksak)` = Excel; dibagikan
  turun kategori→sub→item→anak sehingga **anak selalu menjumlah tepat ke induk**
  (agregat konsisten, aturan 4 tetap). Uang tetap BigInt rupiah (tanpa sen).
- Verifikasi file user: grandTotal app kini 8.542.625.850 = round(Excel), invariant
  anak=induk lolos (kecuali grup-fallback anak-nol, perilaku lama). Unit test baru
  di `flatten.test.ts` (apportion + fixture desimal); 115 unit test hijau.
- Tidak ada perubahan skema/migrasi. Re-import RAB memakai pembulatan baru otomatis.

## 076 · 2026-07-24 · Kurva-S baseline = S sejati (Beta-PERT), bukan diagonal

- Temuan user (tajam, benar): kurva-S auto dari mesin sequencing (070) cenderung
  **diagonal/lurus**, bukan berbentuk S. Diminta koreksi berdasar KAIDAH UMUM
  konstruksi (bukan spesifik KKP), termasuk mengoreksi pendapatku sendiri.
- Diagnosis (terbukti lintas 6 RAB nyata): `scheduleBySequence` menjumlahkan
  banyak jendela tahap sempit yang menutupi garis waktu merata → laju agregat
  ~konstan → garis lurus. Rata-rata plan pada 20/50/80% waktu ≈ 27/56/96 (lama,
  front-loaded) & 21/53/88 (sequencing) — keduanya jauh dari S ideal ~10/50/90.
- KAIDAH: progres kumulatif = integral kecepatan kerja (naik→puncak→turun:
  mobilisasi→produksi→closeout). Integral histogram lonceng = sigmoid. Laju
  konstan → diagonal = keliru (berarti kru penuh sejak hari-1 s.d. akhir).
- Koreksi: baseline auto kini **kurva-S tingkat proyek** = CDF Beta(α,β)
  (model baku Beta-PERT). `betaCdf` + `constructionScurveWeekly(μ, weeks)` di
  generate.ts. μ = titik-berat waktu (`timeCenterOfGravity` dari placeItems) →
  komposisi RAB hanya MENGGESER puncak; bentuk S (landai–curam–landai) dijamin
  (α,β>1 via clamp μ∈[0.42,0.58], steepness 4.2 ≈ Beta(2,2)=10/50/90).
- Sequencing per-unit (placeItems/stagePlannedFraction) TETAP dipakai rekomendasi
  mingguan (urutan pekerjaan) — itu bagian yang benar, tak diubah. Yang diganti
  hanya bentuk kurva agregat.
- Hasil kode asli lintas RAB nyata: 20/50/80% waktu ≈ 11–14 / 53–58 / 91–93
  (S ✓). Laporan periodik & chart workspace baca BaselinePoint tersimpan → sama.
- Baseline lama di DB perlu **"Hitung ulang"** per lokasi (atau import ulang RAB)
  agar mengikuti S baru. Unit test baru: betaCdf + properti S (123 test hijau).

## 077 · 2026-07-24 · Kurva-S = cost-loaded schedule × envelope ramp (menyempurnakan 076)

- Lanjutan tajam dari user: "apakah sudah mempertimbangkan urutan/metode kerja?"
  → mekanisme Beta μ-saja (076) hanya mencerminkan sequencing lewat 1 skalar
  (μ), dan diuji ternyata μ nyaris konstan (0,46–0,48) lintas RAB → kurva
  hampir seragam, tak variatif. User minta BEST PRACTICE yang tak menyalahi
  ketentuan & sesuai realita lapangan.
- Temuan jujur (terbukti): variance sebaran biaya-waktu RAB KNMP ≈ 0,07 (dekat
  seragam 0,083). Jadi cost-loaded MURNI untuk pekerjaan tersebar-merata memang
  ~linear — S kuat BUKAN dari sebaran biaya.
- Kaidah: bentuk S sesungguhnya lahir dari RAMP SUMBER DAYA (mobilisasi kru naik
  bertahap → puncak → demobilisasi/closeout/testing turun) — penjelasan baku
  PMBOK. Itu realita lapangan, bukan kosmetik.
- Mekanisme final (ganti 076): `scheduleBySequence` =
  **cost-loaded schedule × envelope ramp**:
  1. placeItems → jendela urutan-nyata (presedensi lapangan) tiap item;
  2. sebar bobot ÷ durasi per minggu → histogram biaya (mencerminkan metode/
     urutan & komposisi RAB lokasi ini);
  3. modulasi `resourceRamp` (MOBILIZATION=0.2, DEMOBILIZATION=0.2, RAMP_FLOOR=0.3),
     normalisasi Σ=100, akumulasi.
- Hasil kode asli lintas RAB nyata: 20/50/80% waktu ≈ 12–18 / 47–49 / 90 (S sejati,
  dekat patokan 10/50/90), dan VARIATIF antar komposisi. Blok Beta (076) dihapus;
  `betaCdf`/`constructionScurveWeekly` dibuang (superseded). placeItems/
  stagePlannedFraction tetap dipakai rekomendasi mingguan (urutan) — tak diubah.
- Editor kurva-S manual (curveFromCategorySchedule) tak berubah. Baseline lama di
  DB perlu "Hitung ulang" per lokasi. 117 unit test hijau; assertion bentuk-S
  ditambah di sequencing.test.ts.

## 078 · 2026-07-24 · Milestone administrasi: scope induk vs lokasi + sync dari dokumen

- Temuan user (tajam, benar): tracking kepatuhan per-LOKASI, padahal dalam konteks
  banyak lokasi, dokumen induk (SPPBJ, kontrak, jaminan pelaksanaan, SPMK, keabsahan)
  ikut INDUK — dan statusnya cuma flag manual, tak sync walau dokumennya sudah diunggah.
- Akar (satu, bukan dua): `ensureMilestones` mematerialisasi SEMUA 45 milestone
  per-lokasi. Tak ada milestone induk (`locationId null`). Sync docType→milestone
  sebenarnya sudah ada (documents.ts) tapi jadi tercecer: unggah dokumen induk hanya
  menandai SATU salinan lokasi (urut pertama), sisanya tetap "belum" → tampak tak sync.
- Perbaikan:
  - Template: `scope: "paket" | "lokasi"`. INDUK = mayoritas (SPPBJ, kontrak, jaminan,
    SPMK, PCM [acara berbarengan], adendum, termin, SCM, PHO/FHO). LOKASI = hanya
    serah terima lokasi & MC-0 (9 item; tiap desa diukur & disesuaikan sendiri).
  - `ensureMilestones`: induk sekali (locationId null), lokasi per lokasi.
  - Sync `documents.ts`: dokumen induk → milestone induk (satu); dokumen lokasi →
    milestone lokasi itu (OR per scope). Status DITURUNKAN dari dokumen, bukan flag.
  - `milestoneBoard({packageId})` = induk (locationId null); `{locationId}` = lokasi.
  - UI: halaman PAKET/dokumen = papan administrasi induk (editable). Halaman
    LOKASI/dokumen = papan lokasi (editable) + rujukan induk read-only (status ikut induk).
  - Aksi update/verify milestone kini terima `packageId` (revalidate paket) selain slug.
  - Self-heal: `consolidateLegacyPaketMilestones` menggabung salinan per-lokasi warisan
    ke induk (pindahkan dokumen, ambil status paling maju, hapus salinan) — idempoten,
    otomatis saat load; tak perlu migrasi manual.
- Domain (konfirmasi user): MC-0 per lokasi; PCM induk (berbarengan); PHO/FHO atas
  semua lokasi (induk); termin 20/25/30/25 @ progres total 25/50/80% & 100% + retensi 5%.
- Lanjutan (OPEN_ISSUES): (a) serah terima PARSIAL per pekerjaan selesai (mis. revetmen
  100%); (b) auto-flag termin bisa ditagih berdasar progres agregat kontrak + retensi 5%.
- Verifikasi: typecheck ✓ lint ✓ 123 unit test ✓ (test scope baru).

## 079 · 2026-07-24 · Baseline = jadwal presedensi per-KATEGORI (sumber tunggal) — cocok jadwal sipil

- Temuan user (dari 3 jadwal Time Schedule sipil nyata KNMP: Tambakagung, Banggi,
  Karangmangu): (1) "penerangan kawasan" muncul dari minggu-1 padahal harus di
  AKHIR (site/jalan belum jadi); (2) saat kurva-S disesuaikan MANUAL, tabel laporan
  mingguan (Rencana Prestasi & Kumulatif Rencana) TIDAK ikut berubah.
- Akar bersama: tak ada SUMBER TUNGGAL rencana per-kategori. Mesin per-item
  (DECISIONS 070/077) menjadwalkan tahap internal (galian→pasang→finish) pada waktu
  ABSOLUT → mengabaikan presedensi antar-KATEGORI (galian penerangan jatuh di 8–40%).
  Dan `buildKurvaSheet` menghitung ulang dari model auto, bukan baca baseline
  tersimpan → tabel KKP tak sinkron dgn edit manual.
- Bukti kuantitatif jadwal sipil: penerangan 74–100%, jalan 55–90%, landskap 82–100%,
  genset/docking/IPAL 70–95%, persiapan/levelling 0–28%.
- Perbaikan (unifikasi):
  - `CATEGORY_PHASE` dikalibrasi ULANG ke jendela presedensi per-kategori dari jadwal
    sipil nyata (persiapan awal → bangunan tengah → jalan → penerangan/genset/IPAL
    akhir → landskap paling akhir).
  - `autoCategorySchedule(categories, weeks)` (generate.ts): jadwal per-kategori
    (bobot RAB + jendela presedensi) = **sumber tunggal**.
  - `regenerateBaseline` simpan `BaselineScheduleItem` + kurva agregat dari
    `curveFromCategorySchedule` (bukan lagi scheduleBySequence per-item).
  - `buildKurvaSheet` (tabel KKP) BACA jadwal tersimpan per-kategori (sebar rata dalam
    jendela), kumulatif dibulatkan 2 desimal = IDENTIK kurva baseline.
  - `getPeriodReport` sediakan `kurvaSchedule` (tersimpan bila ada; fallback auto).
  - `deriveCategorySchedule` (editor) auto-branch pakai jendela presedensi (bukan
    envelope tahap per-item). Edit manual → BaselineScheduleItem → grafik, tabel KKP,
    deviasi SEMUA ikut.
- Verifikasi RAB nyata: genset/jalan/docking/landskap di ujung; kurva S (6/42/93),
  monoton, 100; kumulatif KKP == kurva baseline (uji). typecheck/lint ✓, 128 unit test.
- Kalibrasi awal dari 3 jadwal; disempurnakan per-lokasi lewat editor manual (yang
  KINI benar-benar propagate ke semua). Baseline LAMA perlu "Hitung ulang" agar
  menyimpan scheduleItems & mengikuti jendela baru. `scheduleBySequence`/envelope
  (077) tak lagi dipakai baseline.

## 080 · 2026-07-24 · Validasi kalibrasi kurva-S ke sumber kredibel + re-test

- Koreksi proses (jujur): kalibrasi kurva-S (070/077/079) semula HANYA dari file
  yang diunggah + pengetahuan model — belum divalidasi ke sumber online kredibel.
  Atas permintaan user, dilakukan riset real-time (Indonesia + internasional).
- Hasil riset MENGONFIRMASI arsitektur & urutan:
  - Metode kurva-S ID (bobot=biaya/total; batang=durasi; akumulasi %/waktu; dipakai
    Kementerian PUPR) = PERSIS model BaselineScheduleItem → curveFromCategorySchedule.
  - Sekuens site-development internasional: clearing/rough grading → utilitas bawah
    tanah → finish grading → paving → LANDSCAPING & LIGHTING terakhir (site amenities).
    Sekuens gedung ID: persiapan → pondasi → struktur → arsitektur/finishing → MEP.
  - → Presedensi kalibrasi (persiapan awal; penerangan/genset/IPAL/landskap akhir)
    selaras. Provenance sumber ditandai di komentar CATEGORY_PHASE (generate.ts).
- Batas jujur: tak ada standar tertulis yang memberi PERSENTASE jendela pasti —
  angka % tetap kalibrasi dari jadwal nyata, disempurnakan per-lokasi via editor manual.
- Re-test menyeluruh: typecheck/lint ✓, 128 unit test ✓, dan 8 RAB KNMP nyata LULUS
  invarian tervalidasi (persiapan awal; penerangan/genset/landskap/IPAL di akhir;
  kurva S landai–curam–landai, monoton, berakhir 100). Kurva agregat konsisten
  6–8 / 38–43 / 88–93 pada 20/50/80% waktu.

## 081 · 2026-07-24 · Distribusi bobot per pekerjaan = LONCENG, bukan rata per minggu

- Temuan user: "bobot ÷ durasi rata" tidak masuk akal — revetmen 5%/5 minggu jadi
  rata 1%/minggu. Pekerjaan nyata naik–puncak–turun, bukan flat.
- Cek data nyata (TS Tambakagung): 9 dari 10 kategori BERVARIASI per minggu
  (mis. PERSIAPAN [2897824], PONDASI [796], JALAN [2449830]) — hanya 1 (2 minggu)
  yang ~rata. Membenarkan keluhan.
- Cek sumber kredibel (2026-07): pengeluaran/produksi per periode sebuah aktivitas
  jarang linear — mengikuti BELL (rendah–tinggi–rendah) peaking di tengah aktivitas,
  terakumulasi jadi S. (Frontline Advisory, GReAT/CPM cash-flow S-curve.)
- Perbaikan: `categoryWeeklyIncrements(bobot, start, end, weeks)` — sebar bobot
  LONCENG dalam jendela: increment mgg-k = bobot × Δsmoothstep(k/durasi). Tiap
  pekerjaan jadi mini-kurva-S; agregat pekerjaan bertahap = kurva-S. Dipakai SATU
  tempat oleh `curveFromCategorySchedule` (grafik/baseline) & `buildKurvaSheet`
  (tabel KKP) → tetap sinkron.
- Contoh: revetmen 5%/5mgg → 0,52 / 1,24 / 1,48 / 1,24 / 0,52 (Σ=5) — bukan rata 1%.
- Verifikasi: typecheck/lint ✓, 128 unit test ✓ (uji lonceng + Σ=bobot + simetris),
  6 RAB nyata → kurva agregat tetap S valid (monoton, berakhir 100, 6–9/38–42/89–94).
  Baseline lama perlu "Hitung ulang" agar ikut distribusi lonceng.

## 082 · 2026-07-25 · Jadwal BERBASIS ITEM (cost-loaded) = sumber tunggal baseline + KKP + saran

- Keluhan user (inti): "kamu meratakan bobot ke jumlah minggu pekerjaan, padahal kamu
  di awal sudah buat pembobotan jadwal atas urutan / berdasar metode kerja. lalu apa
  jadinya sistem saran pekerjaan 1 minggu ke depan kalau begini!" — dua sistem paralel
  saling bertabrakan: (a) jadwal per-KATEGORI (079) + sebar lonceng (081) yang
  memperlakukan tiap kategori sebagai satu blok bobot; (b) saran mingguan (recommender)
  yang MASIH pakai tahap absolut per-item (`stagePlannedFraction`) → tak sinkron dgn
  baseline. Diminta: satukan ke penjadwalan berbasis METODE/urutan item yang sudah ada.
- Pijakan aturan (divalidasi ulang, bukan cuma 3 TS KNMP):
  - PMBOK/CPM: baseline S-curve DITURUNKAN dari jadwal aktivitas ber-presedensi yang
    di-cost-load (durasi ∝ konten biaya/sumber daya) — S adalah HASIL, bukan bentuk
    yang dipaksakan.
  - Last Planner System: rencana mingguan / look-ahead di-EXTRACT dari master schedule
    yang sama — bukan model terpisah. Maka baseline & saran WAJIB satu sumber.
- Model tunggal (`scheduleFromItems`, sequencing.ts):
  - Tiap item RAB → tipe unit (gedung/jalan/marine/utilitas/lansekap/umum) → TAHAP
    (STAGE_TEMPLATES, kini ditafsir RELATIF di dalam unit) → jendela tahap DISARANGKAN
    (`nestedItemWindow`) ke dalam jendela PRESEDENSI SITE-LEVEL unit.
  - Item di-cost-load LONCENG (`categoryWeeklyIncrements`) di jendela bersarangnya;
    profil kategori = Σ item; kurva agregat = Σ semua kategori (`cumulativeFromCategoryWeekly`).
- Jendela presedensi unit = PERAN site-level dari TIPE pekerjaan (`siteRoleWindow`),
  BUKAN tabel kata-kunci per-nama yang rapuh (`getCategoryPhase`). Mengganti bug nyata:
  "PEKERJAAN BANGUNAN GENSET" salah jatuh ke jendela akhir "GENSET" (utilitas) padahal
  itu GEDUNG; "PEKERJAAN TANAH" tak match apa pun → default tengah. Peran:
  umum [0–0.35] · marine [0.05–0.5] · gedung [0.08–0.85] · jalan [0.45–0.95] ·
  utilitas [0.6–1.0] · lansekap [0.78–1.0]. Rumah genset/pabrik es = gedung (envelope
  bangunan biasa); hanya utilitas kawasan sejati (penerangan/IPAL/sumur) di ujung.
- Sumber tunggal ditegakkan di SEMUA hilir dari `scheduleFromItems` + jendela yang sama:
  `regenerateBaseline` (simpan BaselineScheduleItem week-based + kurva), `buildKurvaSheet`
  (tabel KKP), `periodic-report` (kurvaSchedule per-kategori), `saveCategorySchedule`
  (editor manual), dan `computeSuggestions` (saran mingguan pakai `itemPlannedFraction`
  bersarang + jendela kategori yang IDENTIK — tersimpan/manual bila ada, auto bila tidak).
- Verifikasi: typecheck/lint ✓, 129 unit test ✓. Cek RAB campuran realistis (30 mgg):
  kurva mulai 5%, seperempat 20% (< diagonal 25), akhir 100, monoton, ber-S; presedensi
  terjaga — persiapan w1–3 → revetment w6–12 → bangunan w6–24 → jalan w23–27 →
  penerangan kawasan w27–30 → landskap w29–30. Saran mingguan kini SATU jendela dgn
  kurva (look-ahead konsisten). Baseline lama perlu "Hitung ulang".

## 083 · 2026-07-25 · Cetak Jadwal (Time Schedule) + kurva-S di export Excel

- Permintaan user: (1) tombol khusus cetak JADWAL, hasil seperti 3 file Time Schedule
  sipil; (2) export Excel laporan mingguan tak memuat kurva-S padahal PDF ada.
- Cetak Jadwal (rencana + realisasi — pilihan user):
  - Route baru `/cetak/jadwal/[slug]` — dokumen Time Schedule/Kurva-S berdiri sendiri
    (bukan terikat periode): baris kategori × minggu (bobot), kumulatif rencana +
    realisasi s/d minggu berjalan, garis kurva-S, blok TTD. Landscape A4.
  - Reuse `ScurveKkpSheet` dgn `titleOverride` + `periodeOverride` (periode = seluruh
    masa kontrak, snapshot realisasi s/d `bounds.currentWeek`). Butuh SPMK (startDate)
    agar kolom minggu terpetakan ke bulan → gate: hanya muncul bila `getPeriodBounds`.
  - Tombol "Cetak Jadwal" di kartu Kurva-S (progress) & hub Laporan Lokasi.
- Kurva-S di Excel (sheet tabel + gambar — pilihan user):
  - `buildPeriodReportXlsx` kini sheet-1 "Kurva S": tabel bobot kategori × minggu +
    baris kumulatif rencana/realisasi + deviasi (dari `buildKurvaSheet`, angka IDENTIK
    dgn PDF/tabel KKP) + GAMBAR grafik kurva-S. Sheet-2 "Laporan" (detail item, spt dulu).
  - exceljs tak bisa chart garis native → `renderScurveChartPng` (SVG → PNG via sharp,
    sudah dipakai utk gambar) menghasilkan grafik (rencana putus-putus + realisasi hijau,
    sumbu %/minggu, legenda) lalu disisipkan via `addImage`.
- Verifikasi: typecheck/lint ✓, 129 unit test ✓, build ✓ (route terdaftar). Uji end-to-end
  export: workbook 2 sheet + 1 gambar, round-trip; grafik PNG ter-render benar (S-shape,
  garis rencana→100 & realisasi terpotong di minggu berjalan, label sumbu).

## 084 · 2026-07-25 · Import RAB: abaikan baris yang DI-HIDE di Excel

- Temuan user (urgent): importer mengambil semua baris (nilai dari kolom HARGA
  NEGOSIASI bila ada — sudah benar), TAPI beberapa baris SENGAJA di-hide di Excel
  agar tak masuk resume/kontrak — importer tetap menghitungnya → total melembung.
- Perbaikan (`parseHpsWorkbook`): baris dgn `row.hidden === true` (atau `height === 0`
  sbg cadangan) DILEWATI seluruhnya sebelum klasifikasi → tak masuk pohon & tak
  ikut total. Importer mengikuti yang TERLIHAT, sama seperti resume kontrak.
  exceljs membaca atribut hidden Excel/LibreOffice dgn benar (round-trip terverifikasi).
- Peringatan "N baris tersembunyi (hidden) diabaikan" ditambahkan ke `warnings` →
  tampil di banner pratinjau import (user tahu berapa yg dikecualikan). Parser tunggal
  dipakai pratinjau & commit (dijaga hash file) → hidden dikecualikan di dua-duanya.
- Verifikasi: unit test baru (total 21,5jt tanpa 5jt baris hidden + peringatan muncul);
  typecheck/lint ✓, 130 unit test ✓.

## 085 · 2026-07-25 · Import RAB: perampingan xlsx (anti-OOM) sebelum parse exceljs

- Bug (urgent, dari file Lampiran_Negosiasi_PesisirJawa_Timur_HUB1.xlsx): import RAB
  CRASH "JavaScript heap out of memory" saat `wb.xlsx.load`. Diagnosis file mentah:
  `xl/workbook.xml` 4,5 MB berisi **47.746 defined names sampah** (mis. `_` byte rusak
  warisan copy-paste) + **44 sheet volume**; exceljs memuat SEMUA ke model objek →
  heap ~447 MB (batas) terlampaui. Sheet "RAB" sendiri kecil (A1:W1964).
- Opsi ditolak: (a) streaming reader exceljs — HEMAT memori TAPI membuang `row.hidden`
  (uji: 820 baris hidden → terbaca 0), padahal DECISIONS 084 butuh hidden; (b) naikkan
  heap — band-aid, tak scalable ke container kecil / file lebih besar.
- Solusi (`slimRabWorkbook`, xlsx-slim.ts, pakai jszip): unzip → buang `<definedNames>`
  → pangkas `<sheets>` jadi HANYA sheet RAB → simpan closure transitif part yg dirujuk
  (sharedStrings/styles/theme/drawing) via BFS `.rels` → re-zip. Full `.load()` pada
  workbook 1-sheet mungil → atribut sel & `row.hidden` UTUH. Bila pola tak cocok
  (tak ada sheet mirip "RAB"), kembalikan buffer asli (fallback aman). Dipakai
  `parseHpsBuffer` (pratinjau & commit).
- Hasil pada file bermasalah: 5,8 MB → 0,9 MB slim; parse 1,6 dtk (dulu OOM); di bawah
  cap heap 300 MB → heap 52 MB / rss 214 MB (lega). 16 kategori, total Rp 3,89 M,
  794 baris hidden dikecualikan (DECISIONS 084 tetap jalan). +dep langsung `jszip`
  (MIT, sudah transitif via exceljs → audit lisensi tetap hijau).
- Verifikasi: typecheck/lint ✓, 131 unit test ✓ (uji slim multi-sheet+defined names →
  ramping ke RAB & parse benar), build ✓, audit --prod --high exit 0.

## 086 · 2026-07-25 · Kurva-S di Excel = GRAFIK NATIVE (bukan gambar) + Unduh Excel Jadwal

- Permintaan user (menolak DECISIONS 083 bagian gambar): "yang aku mau bukan gambar tapi
  grafis asli seperti contoh yang kuberikan" — chart Excel SUNGGUHAN (bisa diklik/diedit,
  mengikuti sel), seperti file Time Schedule vendor, bukan PNG hasil render.
- Kendala: exceljs TAK BISA menulis chart native. Ditolak: (a) tetap PNG (yg dikeluhkan);
  (b) ganti library chart-capable (dep besar / tak terawat).
- Solusi (`addLineChartToXlsx`, `src/lib/export/xlsx-chart.ts`, pakai jszip): pasca-proses
  buffer hasil exceljs → suntik part OOXML `xl/charts/chart1.xml` (c:lineChart, 2 deret:
  Rencana putus-putus abu + Realisasi hijau, sumbu-Y 0–100% + gridlines, `dispBlanksAs=gap`
  agar realisasi berhenti di minggu berjalan) + `xl/drawings/drawing1.xml` (twoCellAnchor)
  + relasi (drawing→chart, sheet→drawing) + Override content-types + `<drawing>` di
  worksheet. Chart mereferensikan SEL (kategori M1..Mn + baris kumulatif) → live terhadap
  data sheet, angka identik dgn tabel/PDF KKP.
- `buildPeriodReportXlsx` sheet "Kurva S": PNG (083) DIGANTI chart native. `renderScurveChartPng`
  + `scurve-image.ts` dihapus (dead code).
- Tambahan: `buildJadwalXlsx` + route `/lokasi/[slug]/jadwal/export` + tombol "Unduh Excel"
  (di kartu Kurva-S progress & hub Laporan Lokasi, di samping "Cetak Jadwal") — Time Schedule
  1-sheet (tabel kategori × minggu + kumulatif + chart native), gate `getPeriodBounds` (butuh
  SPMK), `requireCapability(report.export)` + `requireLocationAccess` + audit.
- Verifikasi (LibreOffice headless tak fungsional di sandbox → dipakai openpyxl, parser OOXML
  chart ketat): kedua workbook di-parse openpyxl = LineChart valid, 2 deret, ref sel benar;
  sel yg dirujuk berisi kumulatif rencana (→100) & realisasi (berhenti minggu berjalan).
  typecheck/lint ✓, 134 unit test ✓ (uji injektor chart: part+rels+content-types+reload),
  build ✓ (route terdaftar). `server-only` di-alias no-op di vitest agar modul export teruji.

## 087 · 2026-07-25 · Kurva-S = OVERLAY transparan DI ATAS tabel (bukan chart terpisah di bawah)

- Feedback user (bandingkan 2 contoh): mau kurva-S menempel TRANSPARAN di atas tabel time
  schedule — garis menelusuri kolom minggu — persis format TS sipil; bukan chart kotak
  terpisah di bawah tabel (versi 086).
- `chartXml` diubah jadi mode overlay: chartSpace + plotArea `<a:noFill/>` (latar transparan),
  `autoTitleDeleted=1`, TANPA legenda/gridline, kedua sumbu `delete=1` (skala 0–100% tetap
  jalan tapi tak tampil), `plotArea/layout/manualLayout` inner (x0 y0 w1 h1) → plot mengisi
  penuh frame sehingga garis sejajar kolom, `crossBetween=midCat` (valAx). Deret pakai marker
  bulat; Rencana biru (2563EB), Realisasi hijau (16A34A).
- Anchor (`addKurvaSheet`): TEPAT di atas blok kolom minggu — `fromCol=D (FIRST-1)`,
  `toCol=lastCol`; vertikal hanya baris KATEGORI (`firstCatRow-1 … lastCatRow`) supaya baris
  prestasi/kumulatif di bawahnya tetap bersih & terbaca. 0-based twoCellAnchor → kurva ikut
  ukuran sel.
- Bersih-bersih: `LineChartSpec.title` + opsi `chartTitle` dibuang (overlay tak berjudul;
  sheet punya banner sendiri).
- Verifikasi: typecheck/lint ✓, 134 unit test ✓ (uji ditambah: `noFill` transparan +
  `manualLayout` + tepat 2 sumbu `delete=1`), build ✓. openpyxl: LineChart 2 deret; anchor
  D..kolom-terakhir × baris kategori (dikonfirmasi dari drawing1.xml).

## 088 · 2026-07-25 · Kurva-S: skala 0–100% (KET) + titik marker tak kepotong

- Feedback user (screenshot Excel): (1) titik marker kurva kepotong di tepi atas frame;
  (2) tak ada penanda skala 0–50–100 vertikal seperti kolom "KETERANGAN" pada TS sipil —
  di Excel MAUPUN PDF.
- Fix marker kepotong: `plotArea/manualLayout` inner di-inset vertikal (y=0.03, h=0.94) →
  titik di 0%/100% tak lagi menyentuh tepi frame (offset ~3% terhadap label KET, dapat
  diabaikan).
- Skala 0–100% (Excel, `addKurvaSheet`): tambah kolom "KET" di kanan (setelah kolom minggu).
  Header KET merge 2 baris; sel per baris kategori diberi garis sumbu kiri (border medium).
  Label 100/75/50/25/0 ditaruh di baris kategori proporsional (100 valign-top di baris
  pertama, 0 valign-bottom di baris terakhir, 50 di tengah; 75/25 bila ≥6 kategori) → sejajar
  rentang vertikal kurva (chart di-anchor firstCatRow..lastCatRow). Banner ikut melebar ke KET.
- Skala 0–100% (PDF, `ScurveKkpSheet`): sumbu % kanan lama (samar) diganti — garis sumbu
  vertikal + tick + label 100/75/50/25/0 tebal di kolom KET, sejajar gridline. Garis rencana
  jadi biru solid + titik marker (dulu abu putus-putus), realisasi hijau + marker; legenda
  header disesuaikan.
- Verifikasi: typecheck/lint ✓, 134 unit test ✓, build ✓. openpyxl: kolom KET (Z) berisi
  100(top)…0(bottom) sejajar baris kategori; manualLayout y=0.03/h=0.94.

## 089 · 2026-07-25 · Kurva-S Excel: SCATTER mulai dari origin 0% (bukan line/kategori)

- Feedback user (screenshot render Excel): kurva TIDAK mulai dari 0 — titik pertama (M1)
  langsung di kumulatif ~12% (line/kategori memplot titik di M1 tanpa origin), "agak naik
  sedikit". Minta kurva mulai dari 0 di kiri-bawah.
- Akar: chart garis kategori (`c:lineChart`, titik di tengah band) tak punya titik (0,0) &
  tak bisa menaruhnya di tepi kiri.
- Solusi: ganti ke SCATTER (`c:scatterChart`, XY). Deret pakai `c:xVal`/`c:yVal` numerik.
  Ditambah baris HELPER TERSEMBUNYI di sheet: X = `0,1,…,N` (origin + akhir tiap minggu),
  Y-rencana = `0, kumRencana…`, Y-realisasi = `0, kumRealisasi…` (null pasca minggu berjalan
  → gap). Sumbu-X `min=0,max=N` → X=0 di tepi kiri (mulai 0%), X=w di w/N lebar (menembus tepi
  kolom minggu, konvensi TS sipil). `plotVisOnly=0` supaya baris tersembunyi tetap diplot.
- `LineChartSpec`: `catRef`+`valRef`+`dash` → `xRef`+`yRef`+`xMax`. Inset plot y=0.02/h=0.96
  (anti-marker-kepotong, dari 088).
- PDF (`ScurveKkpSheet`) sudah mulai dari 0 (prepend `0,plotH`) sejak awal — tak berubah.
- Verifikasi: typecheck/lint ✓, 134 unit test ✓ (uji diubah ke scatter: xVal/yVal + plotVisOnly=0),
  build ✓. openpyxl: ScatterChart; baris helper Y-rencana = [0, 1.85, 4.75, …] (MULAI 0).

## 090 · 2026-07-25 · KETERANGAN = batang skala 0–100% checkerboard hitam-putih

- User minta (berulang, dgn contoh): penanda vertikal 0–100% bergaya BATANG KOTAK-KOTAK
  HITAM-PUTIH (checkerboard) seperti kolom "KETERANGAN" TS sipil — bukan sekadar angka.
- Excel (`addKurvaSheet`): kolom KET tunggal → 3 kolom (2 kolom sempit batang checkerboard
  `scaleA`/`scaleB` + 1 kolom label). Header "KETERANGAN" merge 3 kolom × 2 baris. Per baris
  kategori: `scaleA`/`scaleB` diisi solid HITAM/PUTIH selang-seling (checkerboard) →
  batang skala sejajar rentang vertikal kurva; label 100/75/50/25/0 di kolom kanan batang.
- PDF (`ScurveKkpSheet`): sumbu KET diganti batang checkerboard 10 pita (10%/pita) × 2 kolom
  hitam-putih + bingkai + label 100/75/50/25/0.
- Verifikasi: typecheck/lint ✓, 134 unit test ✓, build ✓. openpyxl: baris kategori scaleA/scaleB
  = FF000000/FFFFFFFF selang-seling; label 100(top)…0(bottom).

## 091 · 2026-07-25 · Kepatuhan: UNGGAH dokumen inline di tiap item (status ikut dokumen)

- Keluhan user (dgn contoh Figma): form "Kelola" tiap item kepatuhan hanya berisi Status/PIC/
  Jatuh tempo/Catatan — TAK ADA tempat mengunggah dokumennya; upload harus lewat form terpisah
  ("Milestone bukti untuk"). "Kelola lalu isi status" jadi terasa sia-sia, padahal subjudul &
  template sudah menyatakan "status otomatis dari dokumen yang diunggah".
- Fix (paket & lokasi, komponen `MilestonePanel` dipakai bersama):
  - Form Kelola (`MilestoneEditForm`) kini punya **FILE ATTACHMENT** (unggah PDF/DOCX langsung),
    daftar dokumen terlampir, catatan jadi Textarea, tombol "Simpan Perubahan"/"Tutup". Muncul
    bila `document.upload`.
  - `updateMilestoneAction` terima file opsional → `uploadDocument` (fase & tipe bukti OTOMATIS
    dari template milestone via `milestoneTemplate(templateKey).docTypes[0]`, judul = nama item,
    tertaut ke milestone) → status maju via `statusAfterUpload`.
- Perilaku status = "auto-maju + bisa override" (pilihan user): `statusAfterUpload(current,
  submitted, requiresVerification)` — override manual dihormati; sudah selesai/tidak_berlaku tak
  mundur; selain itu dokumen → "berjalan" (butuh verifikasi) atau "selesai". Fungsi murni, diuji.
- Form upload terpisah lama TETAP (cadangan, pilihan user) utk dokumen tak terkait item.
- Verifikasi: typecheck/lint ✓, 139 unit test ✓ (uji `statusAfterUpload`), build ✓. Jalur upload
  nyata (R2) diuji manual oleh user di app.

## 092 · 2026-07-25 · Cetak Jadwal tetap tersedia sebelum SPMK (asumsi mulai hari ini)

- User: penguncian Cetak Jadwal di balik SPMK benar secara alur, TAPI jadwal (kurva-S rencana)
  harus tetap bisa dicetak sebelum SPMK — bila SPMK masih 0, asumsikan perhitungan saat jadwal
  diminta.
- `getPeriodBounds(locationId, { assume })` + `getPeriodReport(..., { assume })`: bila startDate
  (SPMK) belum ada TAPI `durationDays` diketahui, asumsikan mulai = HARI INI (Asia/Jakarta),
  akhir = mulai + durasi − 1; field baru `assumed: boolean`. Tanpa opsi assume → perilaku lama
  (butuh SPMK) tetap, jadi LAPORAN PERIODIK real tak berubah.
- Cetak Jadwal page & route Unduh Excel Jadwal pakai `assume:true`; page kasih catatan kuning
  "SPMK belum diterbitkan — jadwal dihitung dari asumsi mulai <tgl>". Tombol Jadwal di Progress
  & Laporan Lokasi kini muncul lewat `scheduleBounds` (assume), sedangkan selector laporan
  periodik tetap pakai `bounds` REAL (butuh SPMK).
- Verifikasi: typecheck/lint ✓, 139 unit test ✓, build ✓.

## 093 · 2026-07-25 · Istilah peran "Mandor" → "Pelaksana" (label saja)

- User: ganti istilah "Mandor" jadi "Pelaksana". Yang dimaksud = LABEL peran user `field_supervisor`
  (bukan enum). `ROLE_LABEL.field_supervisor` "Mandor" → "Pelaksana" (satu sumber → propagasi
  ke seluruh UI). Identifier enum `field_supervisor` TETAP (tak ada migrasi).
- TIDAK menyentuh `WorkerRole.mandor` (kategori tenaga kerja laporan harian) — enum itu SUDAH
  punya `pelaksana` DAN `mandor` sebagai kategori berbeda; rename akan bentrok. Label "Mandor"
  di WORKER_ROLE_LABEL tetap.
- Komentar konteks-peran ("PM→SM/Mandor", dst) ikut diselaraskan ke "Pelaksana".
- Verifikasi: typecheck/lint ✓, 139 unit test ✓, build ✓.

## 094 · 2026-07-25 · Semua dropdown form → Combobox SEARCHABLE (bukan AG Grid)

- User: semua dropdown harus bisa dicari, "jangan monoton". Menyangka AG Grid bisa — TAPI
  searchable select AG Grid = Rich Select (Enterprise, DILARANG CLAUDE.md). AG Grid = grid data,
  bukan kontrol form. → bikin komponen sendiri, tanpa dependency baru.
- `components/ui/combobox.tsx` (`Combobox`): pengganti `Select` yang bisa diketik-cari. DROP-IN —
  terima `<option>` sebagai children ATAU prop `options`; nilai terpilih ditaruh di
  `<input type="hidden" name=…>` supaya tetap ikut FormData Server Action. Kotak cari OTOMATIS
  muncul bila opsi > 7 (daftar pendek tetap ringkas). Mobile-friendly (target ketuk besar, panel
  selebar kontrol), a11y (role combobox/listbox, navigasi keyboard ↑↓/Enter/Esc, klik-luar tutup),
  token-based (tanpa hex). onChange bertipe `(value: string) => void` (bukan event).
- Migrasi 15 file: `Select` → `Combobox` (rename), 6 call-site onChange disesuaikan ke `(value)=>`.
  `Select` primitive di field.tsx tetap ada (belum dihapus) utk kompatibilitas.
- Verifikasi: typecheck/lint ✓, 139 unit test ✓, build ✓. Interaksi/mobile diuji manual user.

## 095 · 2026-07-25 · Import RAB: harga = NEGOSIASI (bug ambil HPS pada header 2-baris)

- Bug (file Lampiran_NEGO_Asemdoyong…): parser mengambil harga HPS padahal ada kolom
  NEGOSIASI. Akar: `detectColumns` mencari baris header ber-"VOL"+"JUMLAH", TAPI file ini
  (a) total-nya berlabel "HARGA TOTAL" (bukan "JUMLAH"), (b) header DUA BARIS — grup
  "HPS | PENAWARAN | NEGOSIASI" (merge) di atas "HARGA SATUAN | HARGA TOTAL" berulang. →
  header tak terdeteksi → fallback klasik G/H = HPS.
- `detectColumns` ditulis ulang, tahan 1- & 2-baris:
  - Baris header utama = punya VOL & SAT (hindari salah-deteksi baris rekap "JUMLAH" kolom B).
  - Deteksi 2-baris: bila baris di bawahnya memuat "HARGA SATUAN", gabungkan label grup
    (nearest-left, merge left-anchored) + sub. Harga = kolom "HARGA SATUAN" di bawah grup;
    total = "HARGA TOTAL"/"JUMLAH".
  - 1-baris: kolom harga = sel grup yg header-harga (mis. "HARGA NEGOISASI", "NILAI HPS"),
    total = "JUMLAH"/"TOTAL" sesudahnya.
  - Prioritas nilai kontrak: **NEGOSIASI > PENAWARAN > HPS** (HPS cuma pagu). Warning kini
    menyebut sumber (nego/penawaran). TKDN tak ketemu → kolom kosong (bukan salah baca harga blok lain).
- Verifikasi file NYATA: "Buat Bedeng" → 1.559.155,82 (nego), bukan 1.707.676,69 (HPS);
  "Pagar Sementara" → 445.884,46 (nego). typecheck/lint ✓, 17 uji hps-parser (2 baru:
  header 2-baris nego, penawaran-tanpa-nego) + full unit ✓, build ✓.

## 096 · 2026-07-25 · Import RAB: item berharga yang punya baris-tambahan tak boleh hilang nilainya

- Bug (file RAB Asemdoyong, dari user "berapa totalnya"): total impor kurang Rp 7,19 jt
  (0,22%) dari total file. Akar di `sumLeaves`: node dgn children memakai HANYA jumlah anak
  dan MEMBUANG `total_price` node itu sendiri. Di kategori XI, item "4" (Pengadaan Tiang,
  Rp 7,19 jt) punya anak nyasar (baris "Pengiriman" berkode **`#REF!`** → dibaca kode kosong
  → nyangkut jadi anak) sehingga nilai induknya hilang.
- Fix `sumLeaves`: leaf → nilai sendiri; grup tanpa nilai (own=0) → jumlah anak; grup yg
  baris-nya memuat SUBTOTAL anak (|own−childSum| ≤ 0,1%) → own saja (anti dobel); selain itu
  (item berharga + baris tambahan, own≠childSum) → **own + childSum**.
- Verifikasi file NYATA: total 3.239.042.115 (persis sama dgn jumlah seluruh baris file);
  kategori XI 213.950.001. typecheck/lint ✓, 144 unit test ✓ (3 uji baru `sumLeaves`), build ✓.

## 097 · 2026-07-25 · Import RAB: JALUR PREVIEW (flatten) juga harus benar — #REF! jadi item sendiri

- Lanjutan 096: user tunjukkan preview impor di app MASIH kurang Rp 7,19 jt (XI=206,76 jt).
  Sebab: preview/commit pakai `flattenParsedRab`+`grandTotal` (BUKAN `sumLeaves` yg diperbaiki
  di 096). `walkItem` di flatten punya bug sama: node dgn anak → exact = jumlah anak, membuang
  nilai node sendiri; plus masalah struktur — item berharga jadi "grup" saat baris #REF! nyangkut.
- Fix di PARSER (akar, sekali untuk semua jalur): baris berkode KOSONG/rusak ("#REF!" terbaca
  kosong) yang punya NILAI sendiri, sedang induk terdekat = ITEM BERHARGA (leaf) → jadikan
  ITEM SIBLING (kode sintetis `~N`), bukan anak. Tree bersih; sumLeaves & flatten dua-duanya benar.
- Verifikasi file NYATA via JALUR APP (flatten+grandTotal): 3.239.042.115; XI 213.950.001.
  typecheck/lint ✓, 145 unit test ✓ (uji baru: parse+flatten grandTotal atas pola #REF!), build ✓.

## 098 · 2026-07-25 · Kegiatan lapangan: Edit + Kendala/Solusi; input foto bisa dari galeri

- **Edit kegiatan draft**: sebelumnya kegiatan lapangan hanya bisa Tambah foto/dokumen/
  Finalkan/Hapus — judul/jenis/tanggal/peserta salah ketik tak bisa dikoreksi tanpa hapus+ulang.
  Tambah `updateActivityAction` (gate `field_activity.manage` + `requireLocationAccess` + audit,
  hanya status draft) + tombol "Edit" (form inline) di `DraftActions`.
- **Kendala & Solusi**: tambah kolom `kendala` & `solusi` (TEXT nullable) di `FieldActivity`
  (migration `20260725000000_field_activity_kendala_solusi`) — "ada kendala/solusi atau tidak"
  eksplisit. Tampil di form buat, form edit, dan kartu (Kendala=tone warning, Solusi=tone success).
- **Input foto**: buang `capture="environment"` dari SEMUA input foto (kegiatan buat/tambah,
  laporan harian). Alasan: `capture` memaksa HP langsung buka kamera; tanpa itu HP menampilkan
  pilihan **Kamera ATAU Galeri**. Cap waktu/GPS tetap direkam saat berkas dipilih.
- **RecalcBaselineButton** dirapikan jadi popover mengambang (`absolute z-30`) — panel konfirmasi
  + banner hasil tak lagi menekan judul kartu / menumpuk kartu tetangga (anti tumpang tindih).
- Penugasan lokasi (buat pengguna & editor penugasan): tambah kotak cari `LocationPicker`
  (nama lokasi ATAU perusahaan). Baris tak cocok disembunyikan (CSS), bukan unmount → centang
  tetap terkirim di FormData walau difilter.

## 099 · 2026-07-25 · Integrasi WhatsApp (WAHA): grup per paket + kirim kegiatan 1 klik

- **Keputusan arsitektur**: kirim laporan/kegiatan ke **grup WhatsApp per PAKET** via
  [WAHA](https://waha.devlike.pro) (self-hosted, Docker terpisah). Karena hierarki
  lokasi→paket, semua kiriman lokasi otomatis ke grup paketnya. Tersimpan di
  `Package.waGroupId`/`waGroupName` (WAHA chatId `…@g.us`). Migration `20260725010000_waha_integration`.
- **Config = SETTING APLIKASI di DB (bukan env)**: disimpan di `AppSetting` (key-value,
  effective-dated) — pola sama dengan Branding — diatur admin di halaman Sistem TANPA
  redeploy (`src/lib/waha/config.ts`: `getWahaConfig`/`setWahaConfig`/`getWahaConfigDisplay`,
  `normalizeWahaBaseUrl`). API key server-only, tak pernah ke klien; form menampilkannya
  tersamar (kosong = pertahankan, `-` = hapus). `saveWahaConfigAction` gate `system.manage`.
  Alasan pilih DB vs env: admin non-teknis bisa ganti server/rotasi key sendiri. Panduan
  deploy: `docs/WAHA_SETUP.md` (image `devlikeapro/waha:latest`, engine NOWEB, scan QR).
- **Klien** `src/lib/waha/client.ts`: `sendText`/`sendImage`/`sendFile` (file base64 dari byte
  R2 sendiri — WAHA tak perlu jangkau presigned URL), `listGroups`, `getSessionStatus`,
  `normalizeGroupChatId`. Auth header `X-Api-Key`.
- **Kirim kegiatan (1 klik)** `sendActivityToWaAction` (gate `field_activity.manage` +
  `requireLocationAccess`): teks ringkas + semua foto (image) + semua dokumen (file) ke grup
  paket; tandai `FieldActivity.waSentAt`/`waSentById` ("✓ Terkirim", bisa kirim ulang). Audit.
- **Set grup**: capability baru `wa.configure` — SEMENTARA super_admin SAJA (permintaan user:
  set ID grup cukup di admin, jangan role lain). Mengirim kegiatan tetap `field_activity.manage`
  (semua peran lapangan). `WaGroupForm` di halaman Paket, 3 cara: (1) pilih dari daftar
  (`listWaGroupsAction`, butuh sesi WORKING + store NOWEB aktif); (2) **link undangan grup** →
  `resolveWaInviteAction`/`resolveGroupByInvite` (join-info→fallback join) — resolve ID TANPA
  store NOWEB; (3) tempel ID manual. WhatsApp tak pernah menampilkan ID grup di aplikasinya,
  jadi cara (2) jadi jalur utama saat engine NOWEB tanpa store.
- **Diagnostik** di Sistem: status koneksi + sesi WA (`wahaStatusAction`).
- Scope iterasi ini: kegiatan lapangan saja (per keputusan user). Laporan harian/progres menyusul.

## 100 · 2026-07-25 · Kirim laporan harian & mingguan ke grup WA (Excel, tombol manual)

- Perluasan WAHA (setelah 099): laporan **harian** & **periodik (mingguan/bulanan)** bisa dikirim
  ke grup WA paket sebagai **Excel** (.xlsx). Keputusan user: **Excel dulu** (PDF butuh Chromium
  headless di server — ditunda), pemicu **tombol manual** per laporan.
- **Builder Excel harian baru** `src/lib/export/daily-xlsx.ts` `buildDailyReportXlsx(KkpDailyData)`
  (satu sheet: identitas → kemajuan item → tenaga kerja → material → peralatan → cuaca/catatan).
  Laporan periodik pakai `buildPeriodReportXlsx` yang sudah ada.
- **Actions** `sendPeriodReportToWaAction` (locationId+kind+n) & `sendDailyReportToWaAction`
  (slug+dateKey) — gate `report.export` + `requireLocationAccess`; getReport→build xlsx→
  `sendText`(caption)+`sendFile`(xlsx) ke `Package.waGroupId`; audit `report.wa_send`.
- **Penanda** `DailyReport.waSentAt`/`waSentById` (migration `20260725020000_daily_report_wa_sent`)
  → indikator "✓ WA <waktu>". Periodik derived (tanpa row) → tanpa penanda.
- **UI** (`laporan-lokasi`): tombol "Kirim ke WhatsApp (Excel)" di kartu laporan periodik saat
  ditampilkan + tombol "Kirim WA" per baris laporan harian final. Nonaktif bila paket belum
  punya grup / WAHA belum diatur.

## 101 · 2026-07-25 · Tag lokasi foto sadar-sumber (Kamera vs Galeri) — perbaiki batch galeri

- **Masalah**: `savePhotoForItem` dulu memprioritaskan GPS perangkat saat upload
  (`stamp.lat ?? exif.lat`), sehingga foto galeri yang di-batch setelah pindah lokasi
  ketag titik upload — bukan titik asli foto.
- **Solusi (per keputusan user)**: input foto dibedah jadi 2 sumber eksplisit
  (komponen baru `src/components/knmp/photo-source-input.tsx`):
  - **Kamera** (`capture=environment`): GPS real-time perangkat → EXIF → titik lokasi proyek;
    waktu = sekarang → EXIF.
  - **Galeri** (tanpa capture): UTAMAKAN EXIF asli foto; bila EXIF tak ada, cadangan sesuai
    pilihan di tombol galeri (`galleryFallback`: "project" = titik lokasi proyek, "none" = tanpa tag).
    GPS perangkat saat upload TIDAK dikirim untuk galeri.
- `savePhotoForItem` (photos.ts) kini menerima `stamp.source`/`fallbackMode`/`locationLat`/
  `locationLng`/`workDate` dan menentukan lat/lng/takenAt sesuai sumber. Koordinat lokasi proyek
  diambil dari `Location.gpsLat/gpsLng` (sudah terisi dari import master / form lokasi).
- Dipakai di kegiatan lapangan (form buat + Tambah foto) dan laporan harian (report-editor).
  Waktu fallback galeri = tanggal kegiatan/laporan (bukan waktu upload).

## 102 · 2026-07-25 · Export Time Schedule: sumber grafik TERTAUT rumus (edit → grafik ikut update)

- **Masalah (temuan user + file editan sipil)**: export TS menulis baris sumber grafik
  (helper tersembunyi) sebagai ANGKA STATIS, tak tertaut ke tabel "Kumulatif Rencana %".
  Saat sipil mengedit tabel, grafik tidak ikut berubah (sampai sipil ubah sel jadi rumus manual).
- **Fix (`src/lib/export/xlsx.ts` addKurvaSheet)**: baris prestasi kini RUMUS —
  "Rencana %" = `SUM(<kolom>catAwal:catAkhir)`, "Kumulatif Rencana %" = kumulatif
  (`=D9`, `=D10+E9`, …). Baris helper sumber grafik = rumus tertaut ke baris kumulatif
  yang terlihat (`helperY = =D10,=E10,…`; `helperR = =D12,…` hanya minggu ber-realisasi),
  sel A tetap 0 (origin agar kurva mulai 0%). `result` diisi supaya tampil sebelum recalc.
- **Efek**: (a) edit tabel kategori otomatis menjalar ke kumulatif → grafik update di Excel;
  (b) pekerjaan dengan MINGGU TERPUTUS (mis. M1–4, jeda M5–6, lanjut M7–10) kini valid &
  tergambar benar — kumulatif mendatar di minggu jeda (…45,45,45,58.75…). Kaidah TS sipil
  membolehkan aktivitas terputus.
- Verifikasi: generate TS sintetis (10 minggu, 1 kategori terputus) → helper Y = `=D10..=M10`,
  kumulatif cache [.,.,45,45,.] benar. Sisa (editor in-app dukung gap + re-import export) menyusul.

## 103 · 2026-07-25 · Jadwal kategori = MATRIKS bobot per-minggu (mendukung minggu TERPUTUS/jeda)

- **Keluhan user (inti, berlarut)**: kurva-S "berlarut-larut" karena jadwal per kategori
  hanya bisa SATU jendela kontigu `startWeek–endWeek`. Pekerjaan yang minggunya TERPUTUS
  (mis. M1–4, jeda M5–6, lanjut M7–14) — yang SAH menurut kaidah TS sipil (menunggu curing/
  pekerjaan lain/material, tahap bertahap) — tidak bisa dijadwalkan, baik auto maupun manual.
  Juga tak bisa menyerap editan Excel sipil (round-trip).
- **Akar (audit end-to-end)**: `BaselineScheduleItem` menyimpan `start_week/end_week` (satu
  jendela). Turunan kurva (`categoryWeeklyIncrements`/`curveFromCategorySchedule`) strictly
  kontigu. Editor = dua input mulai–selesai + gantt satu batang. TAMBAHAN: report & editor
  memakai DUA mesin kurva berbeda (report `scheduleFromItems`, preview editor
  `curveFromCategorySchedule`) → bisa beda. Lapisan tabel KKP & export Excel SUDAH gap-agnostic.
- **Solusi (bentuk kanonik)**: `BaselineScheduleItem.weekly Json` (array increment %/minggu,
  panjang totalWeeks) MENGGANTIKAN start/end. 0 = minggu jeda. `weightPct` = Σ weekly.
  Kurva baseline = Σ semua weekly diakumulasi (`cumulativeFromWeeklyRows`). Konsekuensi:
  - Mendukung jeda secara native (interior nol).
  - SATU sumber: report membaca `weekly` tersimpan langsung = preview editor = kurva
    tersimpan (mesin ganda hilang). Fallback re-derive item-based hanya bila matriks
    belum ada / durasi berubah.
  - Baseline jadi SNAPSHOT sejati (tak lagi drift dgn RAB live; "Hitung ulang" utk refresh).
- **Helper baru (`generate.ts`)**: `weeklyFromSegments(weight, segments[], N)` (lonceng per
  segmen, porsi ∝ panjang), `segmentsFromWeekly(weekly)` (rekonstruksi run kontigu utk gantt),
  `cumulativeFromWeeklyRows(rows[][], N)`.
- **Titik sentuh**: schema+migration (backfill even-spread dari jendela lama), `baseline.ts`
  (derive/save/restore), `rab/import.ts` regenerateBaseline (simpan weekly per kategori),
  `periodic-report.ts` (baca weekly tersimpan + fallback), `plan/suggest.ts` (jendela look-ahead
  = minggu aktif pertama..terakhir dari weekly), `seed/demo.ts`. Editor: segmen (Tambah/Hapus
  rentang) + gantt multi-batang + zod `segments[]`.
- **Verifikasi**: typecheck ✓ lint ✓ build ✓ unit 151 (+5 gap: Σ=bobot, jeda=0, porsi ∝ panjang,
  kurva mendatar saat jeda & tetap monoton/akhir 100, rekonstruksi segmen). Baseline lama →
  backfill even-spread; "Hitung ulang"/simpan editor menghasilkan bentuk eksak.
- **Round-trip (S3)**: re-import Time Schedule Excel (editan sipil) → weekly per kategori →
  baseline. Parser `scurve/jadwal-import.ts` (deteksi header M1..MN, baca baris kategori termasuk
  sel rumus via `.result`, minggu 0 = jeda). Action `importJadwalAction` cocokkan kategori via
  KODE (fallback nama), tolak bila jumlah minggu ≠ durasi kontrak, lalu `saveCategoryWeekly`
  (bentuk/jeda dari Excel dipertahankan, bobot di-RENORMALISASI ke RAB; kategori tak-cocok →
  fallback auto agar kurva tuntas 100). UI: tombol "Impor jadwal dari Excel" di editor jadwal.
  Uji round-trip: export → parse balik → kategori/kode/matriks + jeda (mgg 5–6 = 0) terbaca benar.

## 104 · 2026-07-25 · Export TS: baris realisasi PENUH rumus (kumulatif + sumber grafik) seperti rencana

- **Temuan user**: di export Time Schedule, sisi RENCANA sudah hidup (rumus), tetapi
  "Kumulatif Realisasi Prestasi %" masih statis/kosong dan sumber grafik realisasi cuma
  tertaut untuk minggu yang sudah ada realisasi. "Meskipun kosong, tetap harus pakai rumus
  seperti kumulatif rencana."
- **Fix (`xlsx.ts` addKurvaSheet)** — cermin persis sisi rencana:
  - "Realisasi Prestasi %" = nilai per-minggu aktual (sumber, bisa diedit; minggu depan kosong).
  - "Kumulatif Realisasi Prestasi %" = RUMUS kumulatif (`=D10`, `=D11+E10`, …) utk SEMUA minggu,
    walau selnya masih 0/kosong (blank → 0 dalam rumus → mendatar).
  - "Deviasi +/-" = RUMUS `=kumReal−kumRenc` utk SEMUA minggu.
  - Sumber realisasi grafik (helperR) = RUMUS tertaut ke baris kumulatif realisasi utk SEMUA
    minggu (`=D11…`), bukan lagi hanya minggu ber-realisasi.
  - `result` cache diisi dari kumulatif realisasi carry-forward (increment 0 saat kosong).
- **Efek**: mengisi/mengedit realisasi di Excel otomatis memperbarui kumulatif realisasi,
  deviasi, dan garis realisasi grafik — perlakuan identik dgn rencana. DECISIONS 102 dilengkapi.

## 105 · 2026-07-25 · Dashboard "Aktivitas & Denyut Lokasi" (eksekutif) — feed lintas lokasi + progress per lokasi

- **Kebutuhan user**: eksekutif perlu tahu pergerakan tiap lokasi tanpa membuka satu per satu —
  siapa membuat laporan harian/kegiatan lapangan, ada perubahan jadwal, progress tiap lokasi,
  siapa belum lapor.
- **Sumber data**: BUKAN AuditLog (tak selalu menyimpan locationId). Union tabel domain yang
  ber-locationId: `DailyReportStatusHistory` (via report→location), `FieldActivity`, `Baseline`
  (perubahan jadwal), `Issue` (kendala). Nama aktor di-resolve batch (relasi user tak
  dideklarasikan di tabel histori). Progress dari `getLocationsProgress` (batched, sudah ada).
- **Modul** `src/lib/activity.ts`: `getActivityFeed(locIds|null, limit)` → 50 kejadian terbaru
  (tersortir), + `getLocationActivity(locIds)` → laporan terakhir (tanggal/status/oleh) & aktivitas
  terakhir per lokasi (query "terbaru per lokasi" via `distinct`).
- **Halaman** `/aktivitas` (gate `portfolio.view` = super_admin/PD/AM/PM/exec_viewer; BUKAN peran
  lapangan). Scoped `accessibleLocationIds` (cross-location = semua, selain itu hanya lokasi user).
  Isi: KPI (lokasi aktif · perlu perhatian deviasi<−10 · belum lapor ≥3 hari · aktivitas hari ini),
  feed kronologis (badge jenis + lokasi + aktor + waktu, klik-tembus), sorotan "belum lapor", dan
  tabel progress per lokasi (rencana/realisasi/deviasi + laporan terakhir + denyut) urut deviasi
  terburuk dulu. Nav "Aktivitas" (ikon Activity) setelah Beranda.
- Verifikasi: typecheck/lint/build ✓.

## 106 · 2026-07-25 · Upload dokumen: batas 25MB + MIME toleran + pesan R2 jelas (403 = Cloudflare WAF, di luar kode)

- **Gejala user**: "upload dokumen selalu error, bahkan file kecil". Network inspector: **403**;
  halaman "Sorry, you have been blocked … security solution … malformed data" = **Cloudflare WAF**
  memblokir POST upload di origin gibaku.com SEBELUM sampai ke aplikasi (Ray ID a20b0fb3…). Bukan
  ukuran/kode — biner file / payload Server Action multipart memicu managed rule.
- **Perbaikan sisi kode (berguna terlepas dari WAF)**:
  - `MAX_UPLOAD_BYTES` 15 → **25 MB**; `next.config` `serverActions.bodySizeLimit` 16 → **30mb**;
    label form → 25MB.
  - **MIME toleran** (`resolveUploadMime`): terima file valid meski browser/HP kirim `file.type`
    kosong / `application/octet-stream` / alias (image/jpg) dengan fallback EKSTENSI; simpan mime
    kanonik. Menutup kelas error "jenis file tidak didukung" tersembunyi.
  - Error `r2Put` dibungkus `classifyR2Error` → pesan jelas ("Bucket tidak ada", "Access Key salah",
    dst.) alih-alih dump AWS mentah.
- **Akar 403 (operasional, di tangan pemilik situs)**: Cloudflare WAF. Solusi: (a) buat aturan
  Skip/exception WAF untuk path upload, atau (b) DURABLE — upload presigned LANGSUNG ke R2 dari
  browser (biner tak lewat Cloudflare origin). Menunggu keputusan user; belum diimplementasi.

## 107 · 2026-07-25 · Rombak /aktivitas → "Dashboard Eksekutif" (layout mockup, data nyata)

- **Permintaan user**: rombak total dashboard mengikuti mockup "Dashboard Eksekutif" — 5 KPI,
  Peta Monitoring Lokasi, Status Submit harian, Activity Centre (dengan thumbnail foto), Ringkasan
  Deviasi, Kendala & Solusi Tertunda, kartu Arah Navigasi. (Menu sidebar = contoh; tetap pakai shell asli.)
- **Data (`src/lib/dashboard.ts`)** — komposisi lapisan yang ada, scoped `accessibleLocationIds`:
  - `getDashboardData`: KPI (total lokasi, sudah/belum submit hari ini + delta vs kemarin + %, total
    laporan = laporan harian + kegiatan lapangan hari ini, deviasi kritis <−10pp); daftar belum-submit
    (+laporan terakhir), perlu-perhatian (deviasi<0), ranking deviasi, sebaran region (peta
    provinsi→wilayah), warna pin peta per status submit/deviasi, kendala terbuka/ditangani + aksi
    pemulihan terbaru (PIC `picName`, target `dueDate`, status, flag terlambat).
  - `getActivityCentre`: kegiatan lapangan terbaru + thumbnail foto (presigned via `buildPhotoViews`)
    + tag Kendala/Solusi/Foto/Deviasi.
- **Peta**: reuse `PetaMap` (Leaflet) via wrapper client `dashboard-map.tsx` (filter Semua/Sudah/Belum/
  Kritis + legend); `PetaMap` diberi prop opsional `toneById` untuk mewarnai pin per status submit
  (tak mengganggu halaman `/peta`).
- **UI**: token-based (tanpa hex), komponen `ui/*`; nav "Dashboard Eksekutif" (gate `portfolio.view`).
  Field PIC & target diambil dari `RecoveryAction` (bukan mock). "Total Laporan" = harian + kegiatan.
- Verifikasi: typecheck/lint/build ✓.

## 108 · 2026-07-25 · Dashboard Eksekutif jadi beranda peran manajemen + gabung Command Center

- **Keputusan user**: Dashboard Eksekutif jadi landing setelah login **untuk peran manajemen**
  (`portfolio.view`: super_admin, project_director, PM, regional_manager, exec_viewer, keuangan).
  Peran lapangan (Site Manager/Mandor) TETAP di Command Center yang lebih ringkas — hindari
  membebani user gaptek.
- **Routing** (`src/app/(app)/page.tsx`): `HomePage` → `can(role,"portfolio.view")` ? `ExecutiveDashboard`
  : `CommandCenter`. Command Center di-extract jadi komponen `CommandCenter({user})` di file yang sama.
- **Dashboard di-extract** jadi `ExecutiveDashboard({user})` (`aktivitas/executive-dashboard.tsx`);
  `/aktivitas/page.tsx` tinggal wrapper (alias route, tetap ter-gate). Nav "Dashboard Eksekutif"
  dihapus (Beranda sudah mengarah ke sana bagi manajemen).
- **Info Command Center digabung** ke dashboard: baris "Portofolio & administrasi" — Nilai Kontrak
  (RAB pra-PPN), Nilai Terpasang (+% bar), Paket Aktif, Menunggu Verifikasi (laporan `dikirim`),
  Perlu Koreksi (`perlu_koreksi`) — semua klik-tembus. Data via `getDashboardData(locIds, orgId)`
  (finance dari sum progress; paketAktif/verifikasi/koreksi via count scoped).
- Verifikasi: typecheck/lint/build ✓.

## 109 · 2026-07-25 · Fix upload >1MB gagal (500 digest) — proxyClientMaxBodySize

- **Gejala**: upload dokumen ≥16MB di dev → crash halaman penuh "A server error occurred",
  ERROR digest 3940070422. `serverActions.bodySizeLimit` sudah 30mb & action menangkap error,
  tapi tetap gagal SEBELUM kode kita jalan.
- **Akar masalah**: `src/middleware.ts` (auth) punya matcher yang membungkus SEMUA route.
  Next 16 membatasi body request yang melewati middleware via `experimental.proxyClientMaxBodySize`
  (dulu `middlewareClientMaxBodySize`), **default ~1MB**. Jadi SEMUA body >1MB ditolak framework —
  bukan soal 16mb vs 30mb.
- **Fix**: set `experimental.proxyClientMaxBodySize: "30mb"` di next.config.ts (samakan dgn
  serverActions.bodySizeLimit). Perlu re-deploy (config di-bake saat build).

## 110 · 2026-07-25 · Photo stamp: tata letak mengikuti master layout referensi

- **Fokus (dikoreksi user)**: stamp SUDAH ada; ini soal MENYAMAKAN TATA LETAK dengan gambar
  referensi, bukan fitur baru besar. Aparat besar (schema/settings UI/kategori master) sengaja
  TIDAK dikerjakan.
- **Renderer baru** `src/lib/photo-stamp/renderer.ts` (`buildStampSvg`, pure) meniru komposisi:
  kiri-atas panel perusahaan (navy rounded + aksen), kanan-atas MARLIN/PROJECT CONTROL, kiri-bawah
  badge kategori → nama lokasi (dominan, fit ≤2 baris) → tanggal → garis → koordinat/pelapor/Photo ID
  dgn ikon Lucide (MapPin/UserRound/Camera). Gradient bawah sesuai spec. Landscape & portrait.
- **Util** `src/lib/photo-stamp/format.ts`: `formatStampDateTime` (Sabtu, 25 Juli 2026 • 16:15 WIB;
  tz WIB/WITA/WIT), `formatCoordinate` (6 desimal N/S/E/W), `getContrastText` (WCAG),
  `generatePhotoId` (KODE-YYMMDD-HHMM-URUT). Unit test `tests/unit/photo-stamp-format.test.ts`.
- **Aksen** dapat diubah via AppSetting `photoStamp.*` (`src/lib/photo-stamp/config.ts`, default
  #FF8A00; overlay/toggle/ukuran) — dibaca `savePhotoForItem`. UI Settings BELUM dibuat (default
  berlaku).
- **Kategori badge** dinamis (bukan hardcode "Kondisi Eksisting"): laporan harian = nama pekerjaan
  (RabNode), kegiatan lapangan = label tipe. Photo ID digenerate saat cap (urut per lokasi+hari).
- **Keterbatasan jujur**: (a) font bundle = DejaVu Sans (bukan Inter — perlu regen subset offline);
  (b) logo MARLIN = teks (belum ada aset resmi); (c) teks badge kontras (WCAG) → di atas oranye jadi
  gelap, beda dgn referensi yang putih (bisa diubah bila diminta); (d) belum: persist Photo ID unik,
  simpan file ASLI terpisah, Settings UI + live preview, kategori master.
- Verifikasi: typecheck ✓ lint ✓ 16 unit test ✓ build ✓; pratinjau render landscape+portrait cocok.

## 111 · 2026-07-25 · Menu "Foto Lapangan" — galeri foto lintas lokasi

- **Permintaan user**: menu untuk menampilkan SEMUA foto yang diunggah, layout mengikuti mockup
  preview (galeri per tanggal + KPI + filter + kartu foto + lightbox).
- **Best-practice implementasi** (ke sistem saat ini, tanpa schema baru):
  - `src/lib/photos-gallery.ts`: `getPhotoGallery(locIds, filters)` — foto discope ke lokasi yang
    boleh dilihat user (via relasi report/activity → location), TERPAGINASI (96/hal, jangan muat
    ribuan), thumbnail presigned (`buildPhotoViews`). KPI hari-ini (total/verified/pending) + terkait
    kendala + tanpa-GPS. Judul foto = nama pekerjaan (RabNode) / judul kegiatan; lokasi/pelapor/GPS/
    verifikasi diturunkan dari relasi. Filter: lokasi, status verifikasi, sumber (laporan/kegiatan),
    cari (caption/lokasi/pelapor).
  - `src/lib/photo-verif.ts`: label & tone status verifikasi (dipakai server & client).
  - `src/app/(app)/foto/page.tsx`: heading + 5 KPI + filterbar (form GET) + chip cepat + grid +
    paginasi. Gate `location.view`, scoped.
  - `foto/gallery-grid.tsx` (client): kartu dikelompokkan per tanggal + lightbox in-page.
  - Nav "Foto Lapangan" (ikon camera) setelah "Hari Ini".
- **Ditunda** (dari mockup): pilih-massal + unduh ZIP, view timeline, filter item-pekerjaan/pelapor,
  chip Before/After. Foto tetap diunggah lewat Laporan Harian & Kegiatan Lapangan (tak ada upload
  terpusat baru) — galeri ini murni tampilan/agregasi.
- Verifikasi: typecheck/lint/build ✓.

## 112 · 2026-07-25 · Tagging waktu foto: fix timezone EXIF + metadataSource + penanda "waktu unggah"

- **Sumber waktu cap (`takenAt`)** — `savePhotoForItem`:
  - Kamera: jam perangkat (`photoTakenAt`) → EXIF → waktu unggah.
  - Galeri: EXIF → tanggal kerja → waktu unggah.
- **Fix #1 (bug tz EXIF)**: EXIF menyimpan jam DINDING tanpa timezone. Dulu di-parse tanpa offset →
  di server (UTC) dianggap UTC → bergeser 7 jam saat diformat ke WIB. Sekarang di-parse sebagai
  **+07:00 (WIB)** supaya jam yang dicap = jam di EXIF. (Belum ada tz per-lokasi; asumsi zona proyek WIB.)
- **Fix #2 (transparansi)**: kolom baru `Photo.metadataSource` (enum `PhotoMetadataSource`:
  exif/device/server/manual) mencatat asal waktu. Bila `server` (fallback waktu unggah, BUKAN jepret),
  cap menampilkan penanda amber "· waktu unggah" di sebelah tanggal. Migration
  `20260725190000_photo_metadata_source`.
- Verifikasi: typecheck/lint/build ✓; pratinjau penanda ✓.

## 113 · 2026-07-25 · Pelaksana mendarat langsung di "Hari Ini" (bukan Beranda)

- **Keputusan user**: peran **Pelaksana** (`field_supervisor`) mendarat langsung di **Hari Ini**
  setelah login — alur kerjanya murni input laporan harian, Beranda hanya menambah langkah.
  **Hanya Pelaksana** (bukan Site Manager): Site Manager tetap di Command Center karena tugasnya
  termasuk verifikasi laporan (`daily_report.review`). Manajemen tetap ke Dashboard Eksekutif (DEC 108).
- **Routing** (`src/app/(app)/page.tsx`): `HomePage` → `role === "field_supervisor"` ? `redirect("/hari-ini")`
  : (portfolio.view ? Dashboard : Command Center). Redirect di level "/" (bukan hanya login), jadi
  logo/Beranda pun mengarah ke Hari Ini bagi Pelaksana. `/hari-ini` ter-gate `daily_report.create`
  (dipunyai field_supervisor) — tak ada loop.
- **E2E** disesuaikan: uji `mandor-01` (field_supervisor) kini `toHaveURL("/hari-ini")`.
- Verifikasi: typecheck/lint ✓.

## 114 · 2026-07-25 · Impor rekap laporan harian dari Excel (backfill saat lapangan lupa lapor)

- **Kebutuhan user**: kadang lapangan lupa lapor; admin merekap volume terpasang di Excel lalu
  ingin mengunggahnya. Analog dengan import jadwal, tapi berbeda esensinya.
- **Prinsip yang dijaga**: progress adalah angka **DERIVED** dari laporan harian (`src/lib/progress.ts`,
  CLAUDE.md #4) — TIDAK boleh ada "suntik angka progress". Jadi yang diimpor bukan progress, melainkan
  **rekap laporan harian** (volume per item RAB per tanggal). Impor merekonstruksi `DailyReport` +
  `DailyReportItem` lewat **service yang sama** dengan input manual (`getOrCreateDraft` → `upsertItem`
  → `submitReport`), jadi guard volume kumulatif, hitung nilai, histori status, dan audit tetap berlaku.
  Progress ikut naik otomatis. **Tanpa perubahan skema, tanpa migrasi.**
- **Keputusan user (2 fork)**: (1) rekap **per hari** (kolom Tanggal · Kode/Uraian · Volume) →
  satu laporan per tanggal; (2) laporan hasil impor masuk **"dikirim" (menunggu verifikasi)**, bukan
  langsung final — baru dihitung ke progress setelah manajemen menyetujui.
- **Modul**: `recap-parse.ts` (MURNI, tanpa DB — parser Excel deteksi-header fleksibel + tanggal
  ISO/DD-MM-YYYY + pencocokan ke leaf RAB by kode→nama→contains-unik, penanda masalah
  unmatched/bad_date/future_date/zero_volume/over_volume; bisa diuji unit tanpa env) dan
  `recap-import.ts` (orkestrasi DB: `getRecapLeaves`, `buildRecapPreview`, `commitRecap` urut tanggal
  menaik supaya guard kumulatif benar).
- **UI** `/lokasi/[slug]/harian/import`: unduh template Excel (route `…/import/template`, prisi item RAB
  + sisa volume), unggah → **pratinjau** (baris siap vs bermasalah, dilewati) → **simpan**. Gate
  `daily_report.create` + `requireLocationAccess`; entry lewat tombol "Impor rekap Excel" di Pelaksanaan Harian.
- Uji unit `tests/unit/recap-import.test.ts` (parser + matcher). Verifikasi: typecheck/lint/unit/build ✓.

## 115 · 2026-07-25 · Jenis kegiatan lapangan jadi MASTER DATA + semua dropdown pakai Combobox

- **Keputusan user**: jenis kegiatan lapangan harus bisa dikelola admin ("seharusnya ada master
  datanya"), termasuk menambah **Survei Awal**. Enum `FieldActivityType` diganti tabel master
  **`FieldActivityKind`** (key stabil · label · sortOrder · isActive). `FieldActivity.type` kini
  `String` (key), bukan enum. Migration `20260725200000_field_activity_kind_master`
  (buat tabel + seed 6 lama + Survei Awal, ALTER enum→text via `USING`, DROP TYPE). Sistem belum
  production → migrasi aman.
- **Sumber tunggal** `src/lib/field-activity/kinds.ts` (`getActivityKinds`, `getActivityKindLabelMap`,
  `activeActivityKindKeys`). Label tak lagi hardcode di `labels.ts`. Konsumen label (dashboard,
  activity feed, WA kirim, halaman kegiatan) memakai peta key→label (fallback ke key bila jenis
  dihapus). Form create/edit memuat pilihan dari master (aktif saja; jenis lama tetap tampil di edit
  walau nonaktif). Validasi server: type ∈ jenis aktif.
- **Kelola di Sistem** (`system.manage`): panel "Jenis kegiatan lapangan" — tambah (key auto-slug,
  dijamin unik), ubah nama, aktif/nonaktifkan. Aksi `saveActivityKindAction` + audit. Key immutable.
- **Semua `<select>` → `Combobox` (filterable)**, per aturan user (apalagi opsi banyak): sisa native
  select dikonversi — filter Foto Lapangan (lokasi/status/sumber), Document Center (paket/lokasi/fase/
  tipe), panel cap foto di Sistem (overlay/ukuran), dan fallback GPS di input foto. Selebihnya sudah
  Combobox sejak awal.
- Verifikasi: typecheck/lint/unit(172)/build ✓.

## 116 · 2026-07-25 · Edit nama pengguna · batas 32 foto/kegiatan · jam dari nama file WhatsApp

- **Edit nama pengguna**: aksi `updateUserProfile` (gate `user.manage`, audit `user.update_profile`)
  ubah `fullName` + email (cek bentrok email). UI: tombol "Edit nama" per baris di halaman Pengguna
  (panel inline). Username & peran tidak diubah di sini.
- **Batas 32 foto per KEGIATAN lapangan** (`MAX_PHOTOS_PER_ACTIVITY=32`, di `photos.ts`): `uploadPhotos`
  menerima `limit`. Create → limit 32; Add foto → limit = 32 − foto existing (query count), tolak bila
  sudah 32, dan beri peringatan jumlah yang dilewati. Tidak mengubah batas upload laporan harian.
- **Jam dari nama file WhatsApp**: WhatsApp membuang EXIF, jadi untuk foto galeri tanpa EXIF, ambil
  waktu dari nama file bila polanya mengandung jam (`parseWhatsAppTime` di `photos.ts`): format
  desktop/iOS "WhatsApp Image YYYY-MM-DD at HH.MM.SS[ AM/PM]" (24/12 jam), diasumsikan WIB. Format
  Android "IMG-YYYYMMDD-WAxxxx" hanya tanggal → diabaikan. Urutan sumber waktu galeri kini:
  EXIF → nama file WA → tanggal kerja/server. Enum baru `PhotoMetadataSource.filename`
  (migration `20260725210000_photo_metadata_filename`), `timeApprox=false` (waktu nyata, bukan fallback).
- Uji unit `tests/unit/wa-filename-time.test.ts` (7 kasus). Verifikasi: typecheck/lint/unit(179)/build ✓.

## 117 · 2026-07-25 · Seragamkan nama lokasi (buang prefix "KNMP") + edit nama lokasi

- **Masalah**: nama lokasi tak seragam — alur bypass & buat-cepat-kontrak dari katalog
  meng-generate `KNMP {desa}`, sedangkan lokasi lama/manual pakai nama desa saja. Prefix "KNMP"
  redundan (seluruh sistem = proyek KNMP). Tak ada fitur edit nama lokasi.
- **Keputusan user**: (1) konvensi **tanpa prefix** — nama desa saja; (2) **rapikan data lama otomatis**.
- **Perubahan**:
  - Auto-generate berhenti menambah "KNMP": `package/actions.ts` (2 alur: katalog & bypass) + seed
    `name = m.village`. Placeholder form lokasi manual diubah (contoh desa, bukan "KNMP Desa …").
  - Migration `20260725220000_normalize_location_names`: `regexp_replace(name,'^KNMP\s+','')` untuk
    semua lokasi existing. **Slug TIDAK diubah** (URL stabil) — hanya nama tampilan.
  - **Edit nama lokasi**: aksi `renameLocation` (gate `location.manage` + `requireLocationAccess`,
    audit `location.rename`, revalidate lokasi/paket/index). UI: tombol pensil di samping nama di
    header workspace lokasi (`EditableLocationName`, inline) — muncul untuk super_admin/PD/RM/PM.
    Mengubah nama tampilan saja, slug tetap.
- Verifikasi: typecheck/lint/build ✓.

## 118 · 2026-07-25 · Revisi RAB = adendum HANYA setelah SPMK (bukan sekadar revisi ke-2)

- **Bug**: impor RAB menandai revisi sebagai "adendum" hanya berdasarkan `isAdendum = ada
  revisi aktif` — jadi revisi ke-2 apa pun langsung dicap adendum, walau kontrak **belum SPMK**
  ("menunggu SPMK"). Adendum = perubahan kontrak yang SUDAH berjalan; sebelum SPMK, impor ulang
  cuma **koreksi HPS awal**.
- **Fix** (`lokasi/[slug]/rab/import/actions.ts`): `isAdendum = ada revisi aktif && kontrak sudah
  SPMK` (`Contract.startDate != null`). Sebelum SPMK → source `hps_awal` (label "sumber HPS awal"),
  baseline source `auto` (bukan `adendum`).
- **Koreksi data lama** (migration `20260725225000_relabel_non_spmk_adendum`): turunkan
  `rab_revisions.source` 'adendum'→'hps_awal' dan `baselines.source` 'adendum'→'auto' untuk semua
  lokasi yang kontraknya belum SPMK (start_date kosong / tanpa kontrak).
- Verifikasi: typecheck ✓.

## 119 · 2026-07-25 · Tangkap percakapan grup WhatsApp (Layer A) — webhook WAHA → arsip per paket

- **Tujuan** (kembali ke integrasi AI): arsipkan percakapan grup WA sebagai fondasi ringkasan/telusur
  berbasis AI. Default disepakati: ringkasan harian per lokasi; cakupan **hanya grup tertaut paket,
  teks**; provider AI Claude (lapis B menyusul). Ini **Layer A** — penangkap (provider-agnostic).
- **Skema**: model `WaMessage` (wa_messages) — packageId (nullable, dari waGroupId), chatId,
  waMessageId (unik, dedup), fromNumber/fromName, body, hasMedia/mediaType, fromMe, timestamp, raw.
  Relasi Package.waMessages. Migration `20260725230000_wa_message_capture`.
- **Ingest**: `ingest-parse.ts` (MURNI, teruji unit — parser event WAHA defensif lintas versi
  Core/Plus, WEBJS/NOWEB) + `ingest.ts` (resolve paket via waGroupId; **hanya simpan grup tertaut
  paket**; dedup via upsert waMessageId).
- **Webhook**: `POST /api/waha/webhook` — auth secret via query `?token=` / header `X-Webhook-Secret`
  (timing-safe vs `waha.webhook_secret`); selalu 200 utk event terautentikasi (WAHA tak retry
  karena diabaikan). Secret dikelola di Sistem (`generateWahaWebhookSecretAction`, rotasi) — panel
  menampilkan URL webhook siap-salin + statistik "N pesan tertangkap".
- Uji unit `tests/unit/wa-ingest-parse.test.ts` (6 kasus). Verifikasi: typecheck/lint/unit(185)/build ✓.
- **Layer B (AI) — belum**: butuh ANTHROPIC_API_KEY + egress ke api.anthropic.com; ringkasan harian
  dari WaMessage per paket/lokasi. Menyusul setelah key & egress disiapkan.

## 120 · 2026-07-26 · Rombak halaman /sistem → hub Pengaturan 5-tab (Slice 1)

- **Standar**: mockup user (setting.html) — hub setting ber-header KPI + tab, kartu kesehatan
  layanan, integration-card, matriks hak akses, dll. Prinsip: adopsi struktur + gaya visual, TAPI
  pakai token warna MARLIN (bukan hex mentah) & TIDAK memalsukan data (yang belum ada backend →
  read-only jujur / dihilangkan). Dikerjakan bertahap (Slice 1 = kerangka + pindah panel).
- **Slice 1**: header (judul + environment + KPI: Layanan Aktif/Pengguna Aktif/Sesi/Audit Hari Ini)
  + `SettingsTabs` (client switcher) 5 tab:
  - Ringkasan: Kesehatan Layanan (env/DB/R2/WAHA/sesi), Konfigurasi Penting (read-only), Perubahan Terbaru.
  - Integrasi: R2 (+diagnostik), WAHA (+webhook capture), PostgreSQL (read-only).
  - Akses & Keamanan: Ringkasan Pengguna per peran, Aktivitas Keamanan (audit tersaring), Matriks
    Hak Akses read-only (dari authz.ts — single source of truth, belum editable).
  - Branding & Photo Stamp: Identitas Merek, Cap Foto, Jenis Kegiatan Lapangan.
  - Audit Trail: 100 mutasi + Zona Berbahaya (dev).
- Panel existing (R2/WAHA/Branding/PhotoStamp/ActivityKinds/Reset) dipertahankan, dipindah ke tab
  yang tepat. Semua data NYATA (hitung user/audit/sesi/integrasi). Tanpa SMTP/security-toggle palsu.
- Verifikasi: typecheck/lint/build ✓. Slice 2 (poles per tab sesuai mockup) menyusul.

## 121 · 2026-07-26 · Multi-provider AI (Claude/OpenAI/Mistral/Grok) + pemilih aktif

- **Kebutuhan**: beberapa provider AI tersedia; admin isi API key masing-masing lalu pilih SATU
  yang aktif. Fitur AI (mis. ringkasan percakapan WA) memakai provider aktif.
- **providers.ts** (murni): metadata 4 provider — Claude (Messages API Anthropic),
  OpenAI/Mistral/Grok (chat-completions kompatibel-OpenAI). Default model editable (claude-opus-5,
  gpt-5, mistral-large-latest, grok-4). OpenAI pakai `max_completion_tokens`, lainnya `max_tokens`.
- **config.ts** (server-only, AppSetting effective-dated seperti WAHA): `ai.active_provider` +
  `ai.<id>.api_key` + `ai.<id>.model`. getAiConfigDisplay / setAiProviderConfig / setActiveAiProvider
  / getActiveAiConfig / getAiProviderConfig. Key rahasia (tak pernah ke klien).
- **client.ts** (server-only): `aiComplete()` klien TERPADU (dua bentuk API via fetch) memakai
  provider aktif; `testAiProvider()` untuk tes koneksi. Butuh egress server ke host provider.
- **actions.ts**: saveAiProviderAction / setActiveAiProviderAction (guard: wajib ada API key) /
  testAiProviderAction — semua `requireCapability("system.manage")` + audit.
- **UI**: tab baru **AI** di hub Sistem — kartu per provider (model + API key + Simpan + Tes koneksi)
  + tombol "Jadikan aktif" (badge Aktif). Data nyata, tanpa memalsukan.
- Verifikasi: typecheck/lint/build ✓. Catatan: fitur AI konkret (ringkasan WA) menyusul memakai
  `aiComplete()`; egress ke provider harus diizinkan di environment.

## 121b · 2026-07-26 · Pilihan model AI dari sumber kredibel (kurasi + live /models)

- Field model kini datalist: saran dari (a) kurasi dokumentasi resmi per provider (providers.ts
  knownModels — Claude dari referensi Anthropic; OpenAI/Mistral/Grok dari docs 2026) + (b) tombol
  "Muat model" yang menarik daftar OTORITATIF langsung dari endpoint /models provider
  (listModels/listAiModelsAction) memakai API key tersimpan. Tetap boleh ketik bebas.

## 122 · 2026-07-26 · Laporan Eksekutif → WA (rangkuman AI dikirim ke direksi)

- **Halaman `/laporan-wa`** (capability `exec_report.send` = site_manager ke atas; scope data
  mengikuti penugasan lokasi). Alur: pilih jenis + periode → **Susun (AI)** → **pratinjau/edit** →
  pilih tujuan (kontak tersimpan **per-pembuat** atau input bebas nomor/grup) → **Kirim** (WAHA
  sendText) → histori (ReportDispatch).
- **Fitur utama**: `rangkuman_kegiatan` — rangkuman kegiatan semua lokasi dalam periode (default
  hari ini) untuk direksi. Plus `rekap_kendala` & `kepatuhan_lapor` (harian inti). Katalog
  `lib/exec-report/catalog.ts` extensible untuk jenis lain (kegiatan+foto detail, ringkasan lokasi,
  ringkasan percakapan WA, periodik/roll-up) — menyusul.
- **Pipeline**: `gather.ts` (query FieldActivity + DailyReport + Issue per lokasi, hormati
  `accessibleLocationIds`) → `prompt.ts` (serialisasi data + instruksi anti-halusinasi + format WA)
  → `aiComplete()` (provider aktif, DECISIONS 121). Draf bisa diedit sebelum kirim.
- **Schema**: WaContact (per-pembuat: name + chatId) + ReportDispatch (histori/audit teks kirim);
  migration `20260726010000_exec_report_wa`. authz: capability `exec_report.send` ditambah ke
  site_manager/PM/RM (SA/PD inherit). Nav item "Laporan → WA".
- Verifikasi: typecheck/lint/unit(185)/build ✓. Butuh: provider AI aktif + WAHA terkonfigurasi.

## 123 · 2026-07-26 · Laporan Kegiatan Lapangan → PDF (dokumen A4 rapi: teks + foto)

- **Kebutuhan**: laporan kegiatan lapangan yang bisa dijadikan PDF profesional (teks + foto) untuk
  dilaporkan ke seseorang.
- **Pendekatan**: pola cetak MARLIN yang sudah ada (`app/cetak/*`, A4 tanpa shell, `PrintToolbar` →
  window.print → Simpan PDF). Andal & lintas-platform, tanpa dependensi PDF server.
- **Halaman `/cetak/kegiatan/[id]`** (auth + `requireLocationAccess`): susun jenis, judul, tanggal,
  pelapor, peserta, **uraian**, **kendala**, **solusi**, dan **galeri foto** berlabel (waktu EXIF +
  koordinat) jadi dokumen A4 profesional (`components/knmp/kegiatan-report.tsx`). Foto via presigned
  R2 (600 dtk). Tautan "Cetak / PDF" per kegiatan di tab Kegiatan Lapangan.
- Verifikasi: typecheck/lint/build ✓.
- Menyusul: (a) opsi "susun uraian dengan AI" dari notes mentah; (b) laporan EKSEKUTIF sebagai
  dokumen A4 berdesain (bukan sekadar teks WA).

## 124 · 2026-07-26 · Kirim Laporan Kegiatan sebagai PDF (server-side) ke WhatsApp

- **Kebutuhan**: kirim laporan kegiatan sebagai DOKUMEN PDF rapi (teks + foto) ke WhatsApp, bukan
  hanya teks/foto lepas. WAHA `sendFile` sudah ada (base64), yang kurang: BINARY PDF di server.
- **Keputusan mesin PDF**: `pdfkit` (murni-Node, MIT) — BUKAN headless Chromium. Runner produksi =
  `node:slim` TANPA Chromium; menambah Playwright/Chromium ke image runtime berat & rapuh di
  Railway. pdfkit: teks vektor (bisa diseleksi), alir teks + page-break OTOMATIS (narasi bisa
  panjang → hindari paginasi SVG manual yang rawan salah), foto ditanam via `sharp` (JPEG,
  rotasi EXIF). Alternatif SVG→raster→pdf-lib ditolak: teks jadi raster & paginasi manual.
- **Font**: pakai DejaVu Sans TTF yang SUDAH dibawa aplikasi (`assets/fonts`, sudah di-trace ke
  standalone). Didaftarkan via `registerFont` → pdfkit tak pernah menyentuh font AFM bawaan →
  hindari jebakan tracing `.afm` di build standalone.
- **Tracing standalone**: `next.config` `outputFileTracingIncludes` + `serverExternalPackages`
  tambah `pdfkit`, `fontkit`, `unicode-properties`, `unicode-trie`, `linebreak`, `brotli`, `dfa`,
  `png-js` (require dinamis file data tak terlihat tracer statik). Diverifikasi tersalin ke
  `.next/standalone`. License audit tetap lolos (semua MIT/BSD/dalam allowlist).
- **Modul**: `lib/pdf/document.ts` (fondasi: font, doc A4, palet token, primitif section/meta/
  paragraph/footer i-per-n) + `lib/pdf/kegiatan.ts` (`buildKegiatanPdf(data)` MURNI tanpa I/O,
  dipakai bersama produksi & pratinjau; `renderKegiatanPdf(id)` gather DB/R2 → build).
- **Bug halus diperbaiki**: menulis kaki halaman di pita margin bawah memicu pdfkit menambah
  halaman kosong; diakali dengan menol-kan `page.margins.bottom` sementara saat menulis kaki.
- **Distribusi**: (a) unduhan PDF server-side `GET /api/kegiatan/[id]/pdf` (auth + akses lokasi;
  bukan print browser); (b) tombol "Kirim PDF ke WhatsApp" → `sendActivityPdfToWaAction` (gate
  `field_activity.manage` + `requireLocationAccess` + `audit`), tujuan default grup WA paket ATAU
  nomor/ID bebas ("dilaporkan ke atasan tertentu"). Caption = judul + jenis + tanggal + lokasi.
- Verifikasi: typecheck/lint/unit(185)/build ✓, tracing standalone ✓, smoke-render (font+foto+
  multi-halaman+kaki) ✓. Menyusul: laporan EKSEKUTIF sebagai PDF berdesain.

## 125 · 2026-07-26 · Foto di PDF: link publik MARLIN ke gambar penuh (tak ter-crop)

- **Kebutuhan**: foto di PDF di-crop (`cover`) agar grid rapi → sebagian gambar hilang. Perlu
  tautan aktif ke gambar PENUH di cloud, bisa dibuka penerima WA.
- **Keputusan link** (pilihan user: "link dari MARLIN tapi bisa untuk publik"): route PUBLIK
  `GET /api/foto/[token]` (tanpa login) yang redirect ke presigned R2 pendek. Keamanan = token
  HMAC-SHA256 atas photoId pakai SESSION_SECRET (`lib/pdf/photo-token.ts`) — hanya link yang DIBUAT
  MARLIN valid (bukan tebak id), **permanen** (tanpa kedaluwarsa), dan rotasi SESSION_SECRET
  otomatis mematikan semua link lama. Ditambah ke `PUBLIC_PATHS` middleware.
- **Di PDF**: tiap foto tetap `cover`-crop + chip "Lihat penuh" (kanan-atas) + seluruh sel jadi
  tautan (`doc.link`) ke gambar penuh; catatan satu baris di bawah judul Dokumentasi Foto. URL
  absolut disusun dari origin request (`lib/http.ts getRequestOrigin`, header x-forwarded-*).
- `renderKegiatanPdf(id, { baseUrl })`: pemanggil (route unduh + aksi kirim WA) meneruskan origin.
- Verifikasi: typecheck/lint ✓, token round-trip + tolak tamper/garবage ✓, render PDF berlink ✓.

## 126 · 2026-07-26 · Laporan Harian & Mingguan/Bulanan → PDF ringkas + kirim WA

- **Kebutuhan**: kirim laporan harian & mingguan ke WA sebagai PDF (bukan cuma Excel). Format
  dipilih user: DUA-DUANYA (ringkas profesional + form KKP resmi).
- **Slice ini = format RINGKAS** (bersih, enak dibaca di HP, beda dari Excel) untuk keduanya.
  Format resmi KKP (form bergaris; mingguan perlu landscape) = slice berikutnya.
- **Primitif** `lib/pdf/table.ts`: `table()` (header berwarna + zebra + wrap sel + page-break yang
  MENGULANG header) + `kpiRow()` (kartu KPI). `document.ts` tambah `reportHeader()` + `detailBox()`
  agar semua jenis laporan berbagi kop & kotak identitas.
- **`lib/pdf/harian.ts`** `buildHarianRingkasPdf(KkpDailyData)` + `renderHarianPdf(slug, dateKey)`:
  kop, identitas, KPI (pekerja/cuaca/jam), tabel progres pekerjaan hari ini, tenaga/material/alat,
  catatan. **`lib/pdf/periodik.ts`** `buildPeriodikRingkasPdf(PeriodReport)` +
  `renderPeriodikPdf(locationId, kind, n)`: KPI rencana/realisasi/deviasi (warna), progres per
  kategori + baris TOTAL, sumber daya, kendala.
- **Distribusi**: unduh `GET /api/laporan/harian/[slug]/[date]/pdf` &
  `/api/laporan/periodik/[slug]/[kind]/[n]/pdf` (auth + akses lokasi). Aksi kirim WA
  `sendDailyReportPdfToWaAction` & `sendPeriodReportPdfToWaAction` (gate report.export +
  requireLocationAccess + audit; tujuan grup paket ATAU nomor/ID bebas). UI laporan-lokasi: tombol
  "Kirim WA (PDF)" + "Excel" + "Unduh PDF".
- Verifikasi: typecheck/lint/unit(185)/build ✓ (semua route terdaftar), smoke-render harian &
  mingguan ✓.

## 127 · 2026-07-26 · Fix produksi: pdfkit gagal muat di Railway (pakai bundle self-contained)

- **Gejala (Railway)**: klik "Kirim PDF ke WhatsApp" → `Failed to load external module pdfkit …
  Cannot find module '…/.pnpm/node_modules/@swc/…'`, lalu setelah menyalin dep →
  `applyDecoratedDescriptor is not a function`.
- **Akar masalah**: `serverExternalPackages: ["pdfkit"]` + Next standalone TIDAK menyalin closure
  dep paket external. Menyalin closure per-file (77 paket) via outputFileTracingIncludes MERUSAK
  symlink pnpm yang memaku fontkit ke versi @swc/helpers-nya → Node resolve ke @swc/helpers versi
  lain yang API-nya beda (`applyDecoratedDescriptor` tak ada). Menyalin file tak bisa menjaga
  resolusi pnpm.
- **Keputusan**: muat pdfkit dari **bundle prebuilt self-contained** `pdfkit/js/pdfkit.standalone.js`
  (fontkit + @swc/helpers dll. sudah di-inline, TANPA dependensi eksternal) via `createRequire`.
  Kebal masalah symlink. Cukup trace paket `pdfkit@*` (bundle ada di dalamnya); buang seluruh
  closure-include yang rapuh dari next.config.
- **Verifikasi**: probe `require("pdfkit/js/pdfkit.standalone.js")` + registerFont DejaVu + render
  DIJALANKAN DI DALAM `.next/standalone` (mereproduksi mode produksi) → OK. typecheck/lint/unit(185)/
  build ✓.

## 128 · 2026-07-26 · Fix produksi #2: pdfkit "Cannot find module" → vendor bundle di assets/

- **Gejala (Railway)**: `Cannot find module 'pdfkit/js/pdfkit.standalone.js' Require stack:
  /app/index.js`. Verifikasi lokal DECISIONS 127 ternyata FALSE POSITIVE: `.next/standalone`
  bersarang di dalam pohon proyek, jadi resolusi `require("pdfkit/…")` naik ke `node_modules`
  proyek induk. Di `/app` (produksi) tak ada induk → gagal. Next standalone TIDAK membuat symlink
  `node_modules/pdfkit` untuk paket yang hanya dipanggil via createRequire string.
- **Keputusan**: VENDOR file bundle self-contained ke `assets/pdfkit-standalone.cjs` (2.6 MB, fontkit
  + @swc/helpers inline) dan MUAT via PATH ABSOLUT `process.cwd()/assets/pdfkit-standalone.cjs` —
  TANPA resolusi node_modules sama sekali. assets/ selalu di-copy Dockerfile + di-trace next.config
  (`./assets/**`). Kebal dua jebakan sekaligus (symlink pnpm & symlink top-level Next).
- **Verifikasi BENAR (isolasi)**: salin `.next/standalone/assets` ke `/tmp/appsim` (TANPA
  node_modules), require path absolut + registerFont DejaVu + render → OK. Bukan lagi false
  positive. typecheck/lint/unit/build ✓.
- Catatan: bundle di-pin ke pdfkit 0.15.2; regen bila upgrade pdfkit.

## 129 · 2026-07-26 · Fix render PDF: foto kosong, teks tumpang tindih, kotak tofu

Tiga bug tampilan pada PDF produksi (dari bundle self-contained DECISIONS 128):
- **Foto kosong**: bundle pdfkit self-contained (build browser) MENSTUB `fs`, sehingga
  `doc.image(Buffer)` gagal `fs.readFileSync is not a function` (Buffer bundel ≠ Buffer Node →
  jatuh ke jalur baca file). FIX: beri **DATA URI base64** (`data:image/jpeg;base64,…`) → decode
  inline tanpa fs. Diuji: image XObject + DCTDecode tertanam.
- **Kop tumpang tindih**: judul kanan dipakai lebar penuh + rata kanan → menabrak teks kiri. FIX:
  `reportHeader` — kiri & judul masing-masing di KOLOM 50% (judul boleh wrap). `drawHeader`
  kegiatan kini pakai `reportHeader` (satu sumber).
- **Kotak tofu □**: user mengetik emoji yang tak ada di DejaVu → glyph .notdef. FIX: `sanitizeText`
  (filter code-point: buang emoji/simbol/dingbat/variation-selector/zero-width/kontrol; Latin
  beraksen, ·, →, ©®™ dipertahankan) diterapkan di paragraph/metaRow/table/identitas.
- Verifikasi: typecheck/lint/unit/build ✓, e2e render (emoji + 3 foto) → foto tertanam & tanpa tofu.

## 130 · 2026-07-26 · Rombak UI/UX halaman Kegiatan & Dokumentasi Lapangan

- **Kebutuhan**: tata ulang halaman kegiatan sesuai mockup UI/UX (rapi, desktop & mobile).
- **Layout**: intro + chip ringkasan (Total/Draft/Final dari data nyata) → workspace 2 kolom
  (form kiri STICKY di lg + daftar kanan; menumpuk 1 kolom di mobile).
- **Form** (`CreateActivityForm`): "Informasi utama" (grid) + blok "Kendala & tindak lanjut" yang
  BISA DILIPAT (field tetap di DOM via CSS `hidden` agar tetap terkirim) + blok foto + footer
  Reset/Simpan.
- **Daftar** (`kegiatan-list.tsx`, klien): toolbar cari + filter jenis/status. Kartu di-render di
  SERVER (beserta semua form aksinya) lalu di-passing sebagai `node` + metadata ke komponen klien
  untuk disaring — pola RSC (node server → prop komponen klien), bukan manipulasi DOM.
- **Kartu**: header (pills jenis/status/tanggal + judul + catatan · penulis + Unduh PDF/Cetak),
  ringkasan Peserta/Kendala(warning)/Solusi(success), "Bukti & lampiran" (PhotoGallery +
  ActivityAttachments + hitungan), lalu DraftActions/Reopen + tombol WA (komponen lama, tetap).
- Styling token-only (tak ada hex); komponen aksi lama dipakai ulang (rendah risiko).
- Verifikasi: typecheck/lint/build ✓ (route kegiatan ter-compile; RSC node→klien lolos).

## 131 · 2026-07-26 · Kegiatan: satukan Cetak+PDF jadi satu, rincian PDF 2 kolom

- **Keluhan**: (a) kotak "Rincian" di PDF terlalu lebar (1 kolom, huruf besar, banyak ruang kosong);
  (b) ada DUA tombol "Cetak" (print HTML) & "Unduh PDF" (PDF server) yang ISINYA BEDA — membingungkan.
- **Satukan**: buang halaman print HTML (`/cetak/kegiatan/[id]` + `components/knmp/kegiatan-report.tsx`
  DIHAPUS). Sisakan SATU tombol "Cetak / PDF" → PDF server (`/api/kegiatan/[id]/pdf`), yakni sumber
  yang SAMA dengan yang dikirim ke WA (isi lengkap: Penyedia, No. kontrak, link foto). PDF terbuka di
  browser → bisa langsung dicetak (Ctrl/Cmd+P) atau disimpan. Tak ada lagi dua format berbeda.
- **Rincian 2 kolom**: `drawDetails` ditata ulang jadi 2 kolom + huruf lebih kecil (label 7.5pt,
  nilai 8.5pt). Nilai panjang (Nama proyek/Peserta, >44 char) otomatis memakai baris penuh. Ringkas,
  tak lagi melebar.
- Verifikasi: typecheck/lint/build ✓ (route cetak/kegiatan hilang), render PDF 2 kolom ✓.

## 132 · 2026-07-26 · Forecast v1 — Prognosa penyelesaian (jadwal/fisik)

- Melengkapi siklus Rencana → Aktual → **Prognosa**. Sebelumnya tak ada proyeksi
  ke depan sama sekali. Ruang lingkup v1 = **jadwal/fisik** (biaya = fase berikut,
  lihat docs/FORECAST_DESIGN.md §7). Detail rancangan: docs/FORECAST_DESIGN.md.
- **`src/lib/forecast.ts`** — mesin MURNI `forecastFromSeries(series, startDate)`
  (tanpa I/O; input = kurva-S yang sudah ada). Dua metode EVM-jadwal: **laju terkini**
  (run-rate N minggu, default 4) sebagai utama, **SPI** (aktual%/rencana%) sebagai
  cadangan bila laju terhenti. Keluaran: `forecastFinishWeek/Date`, `slipWeeks`,
  `projectedPctAtEnd`, `velocityPerWeek`, `requiredPerWeek`, `spi`, `status`
  (aman/waspada/telat/selesai/belum_mulai/data_kurang) + garis prognosa `forecastPct[]`.
  100% derived (prinsip #4) — TANPA model DB baru. 8 unit test.
- **Chart**: `ScurveChart` menerima `forecast?` → polyline ke-3 (oranye titik-titik)
  dari titik aktual terakhir. Legenda + % akhir prognosa.
- **Halaman Progress lokasi**: kartu "Prognosa penyelesaian" (status, tanggal selesai
  vs rencana + slip, realisasi vs rencana + deviasi, laju terkini/dibutuhkan + SPI).
  Tanggal hanya bila SPMK terbit (`bounds.assumed=false`); pra-SPMK cukup minggu/status.
  Data < 2 minggu → "data belum cukup" (bukan angka menyesatkan).
- Verifikasi: typecheck/lint/unit(193)/build ✓.
- Menyusul: kolom "prognosa selesai / diprediksi telat" di dashboard eksekutif &
  portfolio; ringkas prognosa di PDF/laporan; forecast BIAYA (butuh tambahan model).

## 133 · 2026-07-26 · AI Intelligence Hub (menu global /ai)

- **Keputusan produk**: AI menjadi menu global mandiri `/ai` (bukan modul duplikat
  per lokasi) dengan 5 tab: Portfolio Pulse, Perlu Tindakan, Report Studio,
  Ask MARLIN, Riwayat & Audit. Halaman lokasi hanya punya tombol deep-link
  (`/ai?scopeIds=<id>`). Sumber: master prompt user 2026-07-26 (hasil diskusi
  arsitektur dgn ChatGPT + Claude), diimplementasi dengan penyesuaian di bawah.
- **Prinsip non-negotiable**: AI BUKAN sumber angka. Semua angka dari calculation
  layer (lib/progress, lib/baseline, lib/forecast, lib/finance); AI hanya
  menjelaskan/merangkum/memprioritaskan/menyusun draf. Setiap output AI melewati:
  skema zod → validasi lokasi ∈ scope → validasi sourceRefId → validasi klaim
  angka (`numericClaimsValid`, ±0.6 thd angka resmi); bagian gagal DIBUANG dan
  tercatat sebagai limitation.
- **Arsitektur**: in-process di service Next.js yang sama (satu web service
  Railway + Postgres). TANPA: MCP, Redis, worker, LiteLLM, agent framework,
  multi-agent, autonomous tool loop, SQL/shell tool. Satu operasi = satu
  panggilan provider terstruktur (maks 1 repair), sinkron.
- **Lapisan deterministik** (`src/lib/ai-hub/`): `source.ts` (portfolio builder
  batched + resolveAiScope intersect izin), `readiness.ts` (Data Readiness Gate,
  bobot eksplisit, unit-tested), `risk.ts` (ruleScore terpisah dari narasi AI;
  TANPA klaim CPM — istilah "kesehatan jadwal"), `quality-rules.ts` (audit
  kualitas: volume>RAB, EXIF mismatch, GPS radius, final tanpa foto, 0% dengan
  bukti, invoice>commitment; status lulus/periksa/gagal/info ditentukan rule).
  Pulse deterministik tetap berfungsi penuh saat provider AI mati.
- **Schema**: `AiRun` (usage inline — 1 run = 1 call, tabel AiUsage terpisah
  tidak memberi nilai; sourceRefs sbg Json — menghindari ledakan baris),
  `AiArtifact` (lifecycle draft→direview→disetujui→beku→terkirim via
  lifecycle.ts; beku immutable + contentHash; runId nullable utk saran
  deterministik), `AiConversation`+`AiMessage` (Ask MARLIN; TANPA menyimpan
  chain-of-thought). Migration `20260726120000_ai_hub` + `..121000`.
- **AI client v2** (`src/lib/ai/`): `aiCall()` dgn usage token + latency +
  finish reason + kode error stabil + timeout (AbortSignal) + maks 1 retry
  (429/5xx/timeout); parser murni `parse.ts` (unit-tested); `structured.ts`
  (JSON-only + zod + 1 repair). `aiComplete()` lama tetap kompatibel
  (laporan eksekutif WA).
- **Proteksi**: API key AI dienkripsi at-rest AES-256-GCM (`src/lib/ai/crypto.ts`,
  env `AI_SECRET_ENCRYPTION_KEY`, format `enc:v1:iv:tag:ct`, baca
  kompatibel-mundur plaintext lama; production TANPA kunci → tolak simpan key
  baru). Guard (`ai-hub/guard.ts` + AppSetting): kill switch global, maks
  run/user/jam (20), run/org/hari (200), lokasi/run (25), input chars, output
  token, ask/conversation; penolakan diaudit. Pricing token opsional (setting
  admin, TIDAK hardcode) → estimatedCostUsd per run. Kontrol di Sistem → AI.
- **Capability baru**: ai.view, ai.generate, ai.ask, ai.report_review,
  ai.report_approve, ai.report_send. field_supervisor TANPA akses AI.
- **Report Studio**: 7 template; satu `structuredContent` kanonik → renderer
  deterministik sama utk pratinjau, cetak A4 (`/cetak/ai/[id]`, PDF via print —
  pola cetak existing), WhatsApp, Excel (`/api/ai-artifact/[id]/excel`,
  exceljs) — angka dijamin identik. Distribusi WA reuse WAHA + WaContact,
  hanya artefak BEKU, riwayat distribusi + hash tersimpan.
- **Perlu Tindakan**: antrean deterministik dari rule risiko; "Simpan Draft"
  membuat artefak `saran` — TIDAK pernah menulis Issue/RecoveryAction domain.
- **Penyesuaian sadar vs master prompt** (dicatat jujur): (1) AiUsage &
  AiSourceRef digabung ke AiRun (lean, fungsi sama); (2) tab = route App
  Router + LinkTabs (pola repo) bukan client tablist; (3) PDF via halaman
  cetak print-A4 (pola repo) bukan pdfkit; (4) dokumen wajib & foto near-duplicate
  belum masuk rules readiness/quality v1 (tercatat sbg limitation); (5) E2E
  Playwright penuh belum ditulis (unit 34 + integration hijau; E2E menyusul).
- Verifikasi: typecheck ✓ lint ✓ unit 227 ✓ integration 13 ✓ build ✓.

## 134 · 2026-07-26 · Kontak WA mandiri · master data perusahaan & lokasi · peta auto-fit

- **Kontak WA** jadi menu mandiri `/kontak-wa` (capability `exec_report.send`,
  per-pemilik) — dipakai distribusi Report Studio AI & laporan eksekutif.
  Action tambah/hapus reuse dari exec-report (revalidate kedua halaman).
- **Master data perusahaan (Vendor)**: kolom baru `address/phone/email/logoKey`
  + form edit per-vendor di /paket/vendor + upload logo (PNG/JPG/WebP ≤2 MB →
  sharp 512px webp → R2 `vendors/{id}/logo.webp`). Profil ini dasar KOP SURAT
  dokumen cetak (wiring kop ke /cetak menyusul). Nama unik per org divalidasi.
- **Master data lokasi**: form edit alamat administratif + KOORDINAT di
  ringkasan lokasi (capability `location.manage` + scope). Validasi rentang
  Indonesia (lat -11..6.5, lng 95..141.5), lat+lng wajib berpasangan; before/
  after tercatat di audit. Koordinat dipakai peta, cap foto, rule GPS AI Hub.
- **Peta auto-fit**: PetaMap tidak lagi hardcode view Jawa — fitBounds otomatis
  ke seluruh marker saat init & saat sebaran marker berubah (lokasi NTB/luar
  Jawa langsung terlihat). flyTo lokasi terpilih tetap.
- **Laporan → WA lama**: DIPERTAHANKAN dulu (rekomendasi: hapus setelah Report
  Studio AI terbukti di produksi — menunggu keputusan user; lihat percakapan).

## 135 · 2026-07-26 · Ringkasan harian chat grup (Layer B) + menu Master Data + kop surat

- **Ringkasan chat grup** (melunasi DECISIONS 119 "Layer B — menyusul"): halaman
  `/chat-grup` (gate `exec_report.send`) — pilih paket tertaut grup + tanggal →
  arsip pesan hari itu (WaMessage, hari Jakarta) + tombol "Ringkas dengan AI".
  Model `WaChatSummary` unik (paket, tanggal); regenerate menimpa (upsert);
  prompt terstruktur (progres/kendala/keputusan/tindak lanjut, maks ~250 kata,
  dilarang mengarang); transkrip dibatasi 500 pesan / 45k karakter (truncation
  dicatat di ringkasan); provider/model + audit tercatat. V1 ON-DEMAND —
  penjadwalan otomatis harian butuh scheduler (belum ada di infra; opsi Railway
  cron → keputusan user, tercatat OPEN_ISSUES). Sinkronisasi ke laporan harian/
  eksekutif = tahap berikut.
- **Menu Master Data** `/master` (tab by-capability): Perusahaan (pindah dari
  /paket/vendor — memang tidak relevan nempel di Paket), Kontak WA (pindah dari
  /kontak-wa), Pengguna (pindah dari /pengguna). URL lama → redirect. Nav:
  entri "Master Data" dgn `anyCapability` (salah satu dari contract.manage /
  exec_report.send / user.create).
- **Kop surat perusahaan** = GAMBAR desain jadi (bukan disusun dari field):
  kolom `Vendor.kopKey`, upload PNG/JPG/WebP ≤2 MB → webp ≤2000×700 → R2
  `vendors/{id}/kop.webp`, pratinjau + hapus di form. Field alamat/telepon/email
  tetap (fallback bila tanpa gambar kop). Penempatan otomatis kop+logo di
  header laporan cetak (/cetak) = MENYUSUL (tercatat OPEN_ISSUES).
