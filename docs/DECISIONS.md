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
