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
  KODE (fallback nama), tolak bila jumlah minggu ≠ durasi kontrak, lalu `saveCategoryWeekly`.
  **DIGANTI DECISIONS 203**: renormalisasi bobot ke RAB bukan lagi perilaku default — angka
  Excel dipakai apa adanya kecuali user meminta penyesuaian. UI: tombol "Impor jadwal dari Excel" di editor jadwal.
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

## 136 · 2026-07-26 · Narasi lapangan (laporan harian + kegiatan) jadi konteks AI Hub

- **Masalah**: sebelumnya kegiatan lapangan & laporan harian hanya masuk AI Hub
  sebagai ANGKA (`activityCount`, `finalReports`) — isinya (judul, jenis, catatan,
  kendala, solusi) tidak pernah dibaca AI. Akibatnya AI bisa bilang "deviasi 90 pp"
  tapi tak bisa menjawab "hari ini di lapangan ada apa saja".
- **Solusi**: `src/lib/ai-hub/narrative.ts` (server, fetch DB) +
  `narrative-format.ts` (MURNI: tipe, `truncateText`, `buildNarrativePayload`,
  `toNarrativeSourceRefs`). Dipisah supaya formatter bisa di-unit-test tanpa env DB.
- **Konten**: per lokasi maks 6 laporan harian (status, cuaca, catatan, maks 6 item
  volume+catatan, jumlah foto) + 8 kegiatan lapangan (jenis, judul, catatan,
  KENDALA, SOLUSI, jumlah foto). Catatan dipotong 240 char, payload dibatasi
  18k char dgn penanda truncation eksplisit.
- **Grounding**: tiap entri punya sourceRefId granular (`slug:laporan:YYYY-MM-DD`,
  `slug:kegiatan:<id>`) + href drill-down; digabung ke `allowedSourceRefIds`
  sehingga AI wajib mengutip entri spesifik, bukan sekadar id lokasi.
- **Batas tegas** (SYSTEM_BASE aturan #6): narasi = konteks KUALITATIF, tidak
  pernah jadi sumber angka progres/deviasi. **Foto TIDAK dikirim sebagai gambar
  ke provider** (vision/OCR tetap di luar scope, DECISIONS 133 §17) — hanya
  jumlah + tautan; AI dilarang mengklaim mendeskripsikan isi foto.
- Aktif untuk kind: pulse, deviasi, risiko, laporan, tanya. PROMPT_VERSION → `hub-v2`.
- UI: kartu "Narasi lapangan (sumber mentah)" di /ai/run/[id] — reviewer bisa
  memverifikasi kutipan AI vs catatan asli, dgn tautan ke laporan/kegiatan.
- Audit `ai.run.buat` mencatat `narrativeEntries`. 10 unit test baru (237 total).

## 137 · 2026-07-26 · Ringkasan chat grup: kiriman MARLIN tertangkap, konteks paket, filter noise, distribusi

- **BUG KRITIS diperbaiki — kiriman MARLIN sendiri tidak pernah terarsip**:
  `ingest-parse.ts` selalu mengambil `chatId` dari `payload.from`. Untuk pesan
  KELUAR (fromMe) WAHA mengisi `from` = nomor kita dan `to` = grup tujuan →
  chatId jadi nomor sendiri → tak cocok `Package.waGroupId` → pesan DIBUANG.
  Akibatnya laporan harian/kegiatan yang MARLIN kirim ke grup hilang dari arsip
  dan ringkasan harian tidak utuh. Fix: bila `fromMe`, chatId dibaca dari `to`
  (fallback berlapis); pengirim = `from`. 2 unit test regresi (masuk & keluar).
- **Panduan WAHA salah** — panel Sistem menyuruh aktifkan event `message` yang
  HANYA membawa pesan masuk. Diubah ke **`message.any`** + banner penjelas;
  tanpa itu pesan keluar tetap tak terkirim ke webhook.
- **Rekonsiliasi kiriman sistem**: `getMarlinDispatches()` membaca data DOMAIN
  (`DailyReport.waSentAt`, `FieldActivity.waSentAt`) → blok "KIRIMAN SISTEM
  MARLIN" di prompt + kartu di UI. Ringkasan tetap menyebut laporan yang sudah
  dikirim walau webhook belum aktif saat itu. Pesan `fromMe` di transkrip
  ditandai `[MARLIN]` supaya tidak dibaca sebagai obrolan anggota.
  Ringkasan kini bisa dibuat walau chat kosong asalkan ada kiriman MARLIN.
- **Konteks paket** (`describePackageContext`): grup WA sering bernama generik
  ("KNMP Jawa"). Prompt kini membawa paket + nomor paket + judul pekerjaan +
  pelaksana + daftar lokasi; ringkasan wajib menyebut identitas pekerjaan.
- **Filter noise** (`isNoiseMessage`, MURNI + teruji): uji webhook/sistem &
  basa-basi satu kata disaring sebelum masuk prompt (konservatif — "Hasil test
  beton sudah keluar" TIDAK dibuang). Pesan noise tetap tampil di UI dgn badge,
  jumlahnya dicatat di ringkasan & audit.
- **Privasi**: prompt melarang menampilkan nomor telepon mentah; tanpa nama →
  tulis "salah satu anggota".
- **Distribusi**: aksi kirim ringkasan satu grup ke kontak WA, dan halaman
  **`/chat-grup/global`** — semua ringkasan pada satu tanggal digabung jadi satu
  pesan WhatsApp (pengantar AI opsional bila >1 paket) untuk pimpinan. Semua
  pengiriman diaudit.
- Verifikasi: typecheck ✓ lint ✓ unit 252 (+15) ✓ build ✓.

## 138 · 2026-07-26 · Identitas pengirim chat grup — ringkasan menyebut ORANG, bukan kode

- **Temuan**: ringkasan ke pimpinan menampilkan angka panjang (mis.
  `86350418202744`). Itu BUKAN nomor telepon melainkan **LID** (Linked ID,
  identitas privasi WhatsApp). Parser membuang suffix `@lid` sehingga tampak
  seperti nomor. Selain itu ekstraksi nama hanya membaca `notifyName`/`pushName`.
- **Perbaikan berlapis** (`sender-identity.ts`, MURNI + 12 unit test):
  1. **Alias manual** (`WaSenderAlias`, unik per org+senderKey) — satu-satunya
     cara andal untuk kasus @lid; dipetakan sekali, berlaku selamanya.
  2. **Pengguna MARLIN** dicocokkan lewat `User.phone` (normalisasi format
     0812/+62/62/8xx) → tampil "Nama (peran)".
  3. **Kontak WA** tersimpan.
  4. **Nama tampilan WhatsApp** — ekstraksi diperluas (`notifyName`, `pushName`,
     `contact.name`, `contact.pushname`, `verifiedBizName`, `participantName`,
     `senderName`); nama yang isinya cuma digit DITOLAK (itu nomor, bukan nama).
  5. **Label anonim aman**: "Anggota grup (belum dikenali)" utk LID, atau
     "Anggota (…1234)" utk nomor. **Kode/LID mentah tidak pernah ditampilkan.**
- **Schema**: `WaMessage.senderJid` (JID mentah, membedakan @c.us vs @lid) +
  model `WaSenderAlias`. `bareNumber()` kini mengembalikan null untuk @lid —
  LID tidak pernah diperlakukan sebagai nomor telepon.
- **Prompt**: AI diinstruksikan memakai nama PERSIS seperti di transkrip (sudah
  terpetakan), dilarang mengarang nama maupun menampilkan nomor/kode.
- **UI**: nama pengirim di arsip chat memakai hasil resolusi; pengirim yang
  belum dikenali mendapat tautan inline **"Beri nama pengirim ini"** (nama +
  peran opsional) — langsung berlaku ke ringkasan berikutnya. Aksi diaudit.
- Verifikasi: typecheck ✓ lint ✓ unit 265 (+13) ✓ integration 13 ✓ build ✓.

## 139 · 2026-07-26 · Chat Grup jadi workspace analisis + siklus hidup ringkasan

- **Masalah**: halaman `/chat-grup` hanya "daftar grup + kotak ringkasan".
  Semua pesan terlihat sama bobotnya (basa-basi setara laporan kendala), tidak
  ada tempat me-review/menyunting draf, dan keluaran AI bisa langsung dikirim ke
  pimpinan tanpa satu pun mata manusia. Itu risiko, bukan fitur.
- **Klasifikasi relevansi deterministik** (`waha/message-classify.ts`, MURNI +
  15 unit test). Rule — bukan AI — yang menentukan bobot:
  `sangat_relevan` (kendala, tindak lanjut) · `relevan` (progres, administrasi,
  koordinasi) · `perlu_interpretasi` (lampiran tanpa teks, teks panjang tanpa
  kata kunci) · `konteks_rendah` (uji sistem, pesan pendek tanpa kata kunci).
  Hanya `useForSummary` yang masuk prompt; saat transkrip harus dipotong,
  kendala/tindak lanjut didahulukan (`orderByRelevance`) supaya yang penting
  tidak kalah oleh basa-basi. Setiap keputusan membawa `reason` yang tampil di UI.
- **Siklus hidup ringkasan** (`waha/summary-lifecycle.ts`, MURNI + 15 unit test;
  enum `WaChatSummaryStatus`):
  `belum_dibuat → draft_ai → (edited_draft) → final → sent`.
  **Draf AI TIDAK PERNAH otomatis final.** `draft_ai`/`edited_draft` tidak bisa
  langsung `sent` — aksi kirim ditolak di server, bukan cuma disembunyikan di UI.
  Menyusun ulang draf boleh dari status apa pun (kembali ke `draft_ai`, versi
  naik); menyunting yang sudah terkirim mengembalikan ke `edited_draft`.
  Ringkasan global hanya mengirim yang `final`/`sent` dan melaporkan berapa yang
  dilewati karena masih draf.
- **Skor keyakinan deterministik** (`computeConfidence`) — AI tidak menilai
  dirinya sendiri. Naik oleh volume bukti & kiriman resmi MARLIN; turun oleh
  rasio pesan ambigu, transkrip terpotong, dan bukti sangat tipis.
- **Schema**: `WaChatSummary` + `status`, `version`, `aiText` (draf AI asli
  sebagai pembanding editan manusia), `confidence`, `marlinCount`,
  `excludedCount`, jejak `generated/edited/finalized` (id + waktu), `lastSentAt`,
  `dispatches` (Json riwayat kiriman). Kolom pelaku sengaja **tanpa relasi FK** —
  nama dicari terpisah; jejak tidak boleh ikut terhapus bersama user.
- **IA 3 kolom** (`/chat-grup`): kiri = scope (grup + tanggal, tiap tanggal
  membawa badge status ringkasan), tengah = bukti percakapan dalam tab WAI-ARIA
  (Pesan relevan · Kiriman MARLIN · Arsip lengkap), kanan = ringkasan AI
  (status, keyakinan, editor, jejak, aksi). Responsif 3 kolom → 2 → tumpuk.
  **Kiriman MARLIN tidak dicampur dengan obrolan anggota** — dipisah jadi
  "menurut data MARLIN" (domain) vs "terekam di grup" (webhook), karena keduanya
  menjawab pertanyaan berbeda.
- **Aksi baru**: `saveSummaryDraftAction` (simpan editan / finalkan) — semua
  lewat `requireCapability("exec_report.send")` + gerbang transisi + `audit()`.
  Pengiriman mencatat riwayat ke `dispatches`.
- Verifikasi: typecheck ✓ lint ✓ unit 295 (+30) ✓ build ✓ browser 1440px & 390px
  (tanpa overflow horizontal) ✓.

## 140 · 2026-07-26 · Fix: urutan kategori tabel Kurva-S KKP tidak ikut urutan RAB

- **Bug**: pada laporan mingguan (sheet "KURVA S MINGGU KE-x"), nomor romawi di
  kolom "No." meloncat — mis. XIV, XV, XVI, XVII, XVIII lalu baru I, II, III …
- **Akar masalah**: baris tabel disusun dari `kurvaSchedule`, yang datang dari
  `baseline.scheduleItems` — query tanpa `orderBy` sama sekali
  (`periodic-report.ts`), jadi Postgres mengembalikan urutan fisik baris. Jalur
  fallback (jadwal diturunkan ulang) juga salah: urutannya mengikuti hasil
  penjadwalan, bukan urutan RAB. Nomor romawi sendiri diambil dari `RabNode.code`
  lewat `codeByName`, dan node RAB memang sudah urut `sortOrder` — sehingga kode
  benar tapi posisi barisnya tidak.
- **Perbaikan**: `orderCategoriesByRab()` di `scurve/kkp-sheet.ts` (MURNI, 4 unit
  test) — mengurutkan baris kategori mengikuti urutan `kategoriNodes`
  (`sortOrder`). Kategori yang tidak ada di daftar RAB ditaruh di belakang dengan
  urutan relatifnya utuh; nama kembar memakai kemunculan pertama. Diterapkan
  sekali di sumber (`periodic-report.ts`) sehingga cetak A4 dan ekspor Excel
  ikut benar tanpa perubahan di masing-masing renderer.
- **Bukan bug**: editor jadwal per kategori sudah benar (`baseline.ts` memakai
  `orderBy: { sortOrder: "asc" }`); konsumen `scheduleItems` lain memetakan lewat
  `lineageKey` sehingga tidak bergantung urutan. Angka bobot/prestasi/kumulatif
  tidak berubah — hanya urutan baris.
- Verifikasi: typecheck ✓ lint ✓ unit 299 (+4) ✓.

## 141 · 2026-07-26 · Upload laporan ke Google Drive folder KKP (per paket)

- **Kebutuhan**: KKP memberi folder Drive per paket; tim wajib menyetor laporan
  ke sana. Akun Gmail biasa milik tim terdaftar sebagai editor folder.
- **Auth**: OAuth akun Gmail tsb (BUKAN service account — file upload service
  account memakan kuota 15 GB miliknya sendiri dan tidak cocok untuk folder
  pemberian pihak lain). Refresh token + client secret disimpan TERENKRIPSI di
  AppSetting (AES-256-GCM, kunci `AI_SECRET_ENCRYPTION_KEY`, pola DECISIONS 121).
  Scope `drive` penuh — `drive.file` tidak bisa menulis ke folder yang bukan
  buatan app. OAuth app HARUS berstatus In production (Testing = token mati 7
  hari); dicatat di `docs/GDRIVE_SETUP.md` + hint UI.
- **Implementasi**: klien Drive v3 via fetch murni tanpa SDK googleapis
  (`lib/gdrive/client.ts` — refresh token cache per proses, multipart upload,
  `supportsAllDrives=true`); util MURNI `lib/gdrive/parse.ts`
  (`parseDriveFolderId` menerima ID/URL, `buildMultipartBody`) + 6 unit test.
  Route `/api/gdrive/auth` + `/api/gdrive/callback` (state anti-CSRF cookie,
  gate `system.manage`).
- **Data**: `Package.driveFolderId` (folder per paket, diatur di halaman paket,
  gate `wa.configure`, validasi akses via `probeDriveFolder` bila akun sudah
  terhubung) + `GDriveUpload` (log append-only: file, status sukses/gagal,
  error, pelaku — upload gagal terlihat & bisa diulang, tidak diam-diam).
- **Trigger MANUAL per laporan** (keputusan user): tombol di halaman
  Laporan lokasi — harian = PDF; mingguan/bulanan = PDF + Excel (reuse
  `renderHarianPdf`/`renderPeriodikPdf`/`buildPeriodReportXlsx`, tanpa pipeline
  baru). Gate `report.export` + `requireLocationAccess` + `audit()`. Status "✓
  Drive <waktu>" tampil per laporan harian dari log sukses terakhir.
- **UI**: Sistem → Integrasi → kartu Google Drive (client ID/secret, hubungkan/
  tes/putuskan, email akun terhubung); halaman paket → kartu Folder Google
  Drive.
- Verifikasi: typecheck ✓ lint ✓ unit 305 (+6) ✓ build ✓ browser /sistem ✓.

## 142 · 2026-07-26 · Fix: redirect URI OAuth Google dipaksa https (di balik proxy)

- **Gejala**: "Access blocked: Authorization Error … Error 400: invalid_request"
  saat menghubungkan akun Google.
- **Akar masalah**: kedua route OAuth memakai `request.nextUrl.origin`. Di balik
  proxy Railway request internal berskema **http**, sedangkan Google MENOLAK
  redirect URI http untuk domain publik. Repo sebenarnya sudah punya pola benar
  (`lib/http.ts` membaca `x-forwarded-proto`), tapi route Drive tidak memakainya.
- **Perbaikan**: `publicOrigin()` + `driveRedirectUri()` di `gdrive/parse.ts`
  (MURNI, 5 unit test) — ambil `x-forwarded-host` → `host`, paksa `https`
  kecuali host lokal (localhost/127.0.0.1/[::1]); daftar koma diambil yang
  pertama. Dipakai SATU sumber di `/api/gdrive/auth`, `/api/gdrive/callback`
  (redirect_uri saat tukar code wajib identik dengan saat consent), dan
  ditampilkan di panel Sistem sebagai kotak "Authorized redirect URI" siap
  salin — operator tidak perlu menebak apa yang didaftarkan di Google Console.
- **Docs**: `docs/GDRIVE_SETUP.md` + daftar penyebab error 400 terurut
  (redirect URI beda, tipe client bukan Web, scope drive belum ditambahkan,
  app masih Testing tanpa test user, propagasi Console).
- **Lanjutan (host, bukan cuma skema)**: ternyata Railway juga tidak mengirim
  `x-forwarded-host`, dan header `host` berisi alamat bind container sehingga
  redirect URI jadi `https://0.0.0.0:8080/...`. Resolusi origin dinaikkan jadi
  berjenjang: `APP_PUBLIC_URL` (override operator) → `RAILWAY_PUBLIC_DOMAIN`
  (otomatis dari Railway) → `x-forwarded-host` → `host`, dengan alamat bind
  (`0.0.0.0`, `::`, `*.railway.internal`) DITOLAK di setiap tingkat. Helper
  server `gdrive/origin.ts` dipakai ketiga titik (auth, callback, panel Sistem)
  supaya tidak mungkin beda. Bila origin tak terdeteksi, panel Sistem
  menampilkan peringatan + instruksi set `APP_PUBLIC_URL` (bukan diam-diam
  mengirim URI ngawur ke Google).
- **Lanjutan-2 (redirect balik, bukan cuma redirect_uri)**: setelah OAuth
  BERHASIL, browser diarahkan ke `http://0.0.0.0:8080/sistem?gdrive=terhubung`
  — token sudah tersimpan tapi halamannya tak bisa dibuka. Sebabnya semua
  `NextResponse.redirect` di kedua route masih memakai
  `request.nextUrl.origin`. Ditambah helper `appUrl()` yang memakai origin
  publik (fallback ke nextUrl.origin), dipakai di SEMUA redirect. Flag `secure`
  cookie state juga ikut origin publik, bukan protokol request internal.
- Verifikasi: typecheck ✓ lint ✓ unit 314 (+9) ✓.

## 143 · 2026-07-27 · Struktur 9 folder KKP di Drive + foto & kegiatan lapangan ikut

- **Konteks**: tiap Drive paket dari KKP punya struktur baku 9 folder bernomor
  (1. SPPBJ…DED, 2. PCM, 3. LAPORAN HARIAN, 4. MINGGUAN, 5. BULANAN,
  6. DOKUMENTASI, 7. BERKAS TERMIN, 8. SHOP DRAWING, 9. AS BUILT). Sebelumnya
  MARLIN menaruh semua file di akar folder paket.
- **Struktur**: `<folder paket>/<folder KKP>/<Nama Lokasi>/…`. Lapisan lokasi
  ditambahkan supaya satu paket berisi banyak lokasi tetap seragam. Harian &
  kegiatan diberi lapisan bulan `2026-07 Juli` (urut alfabet = urut kronologis).
  Foto laporan harian di subfolder `Foto`; kegiatan lapangan satu folder per
  kegiatan berisi PDF + fotonya.
- **Cari-dulu-baru-buat** (`ensureFolder`): folder dicocokkan by name di dalam
  parent; hanya dibuat bila tidak ada. Folder buatan KKP yang sudah berisi file
  dipakai apa adanya, tidak pernah terduplikasi. Cache per proses menekan
  panggilan berulang saat mengupload banyak file.
- **Cakupan baru**: (a) foto laporan harian ikut terupload — KKP menilai bukti
  visual, bukan hanya narasi; (b) kegiatan lapangan (PDF + foto) → folder 6;
  (c) dokumen administrasi → folder sesuai JENIS dokumen. Jenis dokumen proses
  tender internal (undangan, penawaran, BA evaluasi/negosiasi, sanggah) sengaja
  TIDAK dipetakan — ditolak dengan pesan jelas, bukan ditaruh sembarangan.
- **Schema**: `DocumentType` + `ded`, `shop_drawing`, `as_built` (folder 1/8/9
  sebelumnya tidak punya sumber sama sekali). `GDriveUploadKind` + `kegiatan`,
  `dokumen`.
- **Ketahanan**: satu file gagal tidak membatalkan sisanya; tiap file dicatat
  sukses/gagal di `GDriveUpload` dan bisa diulang. Foto yang tak terbaca dari R2
  dilewati & dilaporkan jumlahnya — laporan utamanya tetap naik.
- **Kelengkapan** (`coverage.ts`): halaman paket menampilkan 9 folder × (sumber
  di MARLIN, terupload / layak disetor, gagal, terakhir kapan) — menjawab "mana
  yang belum disetor ke KKP" tanpa membuka Drive.
- Verifikasi: typecheck ✓ lint ✓ unit 334 (+20) ✓ build ✓.

## 144 · 2026-07-27 · Rute folder Drive lewat MILESTONE (bukan hanya jenis dokumen)

- **Temuan**: 18 dari 45 milestone template KKP tidak punya jenis dokumen
  sendiri (Pakta Integritas, Justifikasi Teknis, BA Pemeriksaan, Permohonan CCO,
  BA Pembahasan, dst) → tersimpan sebagai `lainnya` → tidak punya tujuan folder
  di Drive dan tak pernah tersetor.
- **Keputusan**: JANGAN tambah 18 nilai enum. Dokumen sudah tertaut milestone
  (`Document.milestoneId`), dan milestone jauh lebih spesifik daripada jenis
  dokumen. `documentPath()` kini menentukan tujuan berurutan: **milestone dulu,
  jenis dokumen sebagai cadangan**. Contoh nyata: jenis `undangan` sendiri tidak
  dipetakan (bisa undangan apa saja), tapi milestone `undangan-pcm` jelas milik
  folder 2.
- **`folderForMilestone()`** memetakan SELURUH 45 milestone: perencanaan /
  penunjukan / kontrak / adendum / SCM → folder 1; PCM + seluruh rangkaian MC-0
  → folder 2; termin + serah terima pekerjaan (PHO/FHO) → folder 7. Unit test
  menjaga invarian: setiap milestone template WAJIB punya tujuan folder.
- **Jenis dokumen baru** `rks` & `smkk` (dokumen bernama & berulang, layak punya
  tipe sendiri) → folder 1; milestone `ded`/`rks`/`smkk` diberi `docTypes`
  supaya unggah inline dari milestone terisi otomatis.
- `coverage.ts` dan halaman Dokumen memakai rute yang SAMA PERSIS dengan aksi
  upload — hitungan kelengkapan tidak bisa meleset dari kenyataan.
- Verifikasi: typecheck ✓ lint ✓ unit 342 (+8) ✓ integration 13 ✓ build ✓.

## 145 · 2026-07-27 · Laporan harian ke Drive memakai BLANKO KKP, bukan ringkasan

- **Masalah**: yang disetor ke Drive adalah `buildHarianRingkasPdf` — ringkasan
  naratif (KPI + tabel item yang ada volumenya). KKP menerima **blanko resmi**:
  kop tiga kolom, identitas proyek, progres per item dengan Vol Kontrak & s/d
  Lalu, tenaga kerja + material/peralatan berdampingan, matriks cuaca per jam,
  jam kerja, catatan, dan blok tanda tangan Konsultan Pengawas / Kontraktor.
- **`pdf/grid.ts`** (baru): grid bergaris penuh untuk FORMULIR — beda dari
  `table.ts` yang bergaya laporan modern (garis tipis horizontal). Mendukung
  colSpan, tinggi baris mengikuti isi, dan `colWidths()` yang membulatkan
  sisa lebar ke kolom terakhir supaya garis kanan tidak meleset.
- **`pdf/harian-kkp.ts`** (baru): `buildHarianKkpPdf` meniru komponen web
  `KkpDailyReport` supaya cetakan layar & setoran Drive IDENTIK. A4 **lanskap**
  (matriks cuaca butuh 16 kolom). Sumber data sama (`getKkpDailyData`) — tidak
  ada query baru dan tidak ada kemungkinan angka berbeda.
- **Paginasi manual**: `doc.page.margins.bottom = 0` mematikan auto-page-break
  pdfkit (yang menghasilkan 4 halaman kosong pada uji pertama); perpindahan
  halaman dikendalikan `fit()`, header tabel progres diulang di halaman baru,
  dan blok cuaca / jam kerja / catatan / tanda tangan dijaga tidak terpotong.
- **Cakupan**: hanya kiriman Drive yang berubah. Kiriman WhatsApp tetap PDF
  ringkas — di layar HP blanko lanskap tidak terbaca.
- Verifikasi: typecheck ✓ lint ✓ unit 342 ✓ build ✓ render sampel 14 item →
  2 halaman, tata letak & footer benar (diperiksa visual).

## 146 · 2026-07-27 · Upload Drive memperbarui file (revisi), bukan menumpuk kembar

- **Gejala nyata**: dua file `Laporan Harian - Pasar Banggi - 2026-07-21.pdf`
  di folder yang sama. Penyebab: `uploadToDrive` selalu POST (create), sedangkan
  Drive MEMBOLEHKAN nama ganda dalam satu folder — jadi tiap upload ulang
  menambah file, bukan memperbarui.
- **Perbaikan**: cari dulu file bernama sama di folder tujuan
  (`findFileInFolder`, trashed=false). Bila ada → **PATCH** ke fileId itu
  (`uploadType=multipart`), yang oleh Drive dicatat sebagai **revisi baru**:
  isi lama tetap tersimpan & bisa dibuka lewat "Kelola versi", dan tautan yang
  sudah dibagikan ke KKP tidak berubah. Bila tidak ada → POST seperti biasa.
- `keepRevisionForever=true` supaya revisi lama tidak dipangkas otomatis Drive —
  laporan resmi harus bisa ditelusuri kapan pun. PDF laporan kecil, biaya kuota
  tidak signifikan.
- Saat MEMPERBARUI, metadata `parents` TIDAK dikirim — Drive menolak perubahan
  induk lewat body (pemindahan folder butuh addParents/removeParents).
- `uploadToDrive` mengembalikan `created: boolean`; `summarize()` (dipindah ke
  modul MURNI + 5 unit test) membedakan "file baru" vs "file diperbarui (versi
  baru di Drive)" supaya user tahu tidak ada yang terhapus.
- **Tidak dilakukan**: menghapus file kembar yang terlanjur ada. Menghapus
  otomatis di Drive milik KKP terlalu berisiko — didokumentasikan sebagai
  langkah manual di `docs/GDRIVE_SETUP.md`.
- Verifikasi: typecheck ✓ lint ✓ unit 347 (+5) ✓ build ✓.

## 147 · 2026-07-27 · Fix: kumulatif snapshot laporan harian tidak dibatasi tanggal

- **Gejala** (dari laporan produksi Pasar Banggi 21–23 Juli): kolom "s/d" selalu
  mentok = volume kontrak & 100% di SEMUA hari, dan "s/d Lalu" berbeda-beda tanpa
  alasan (Selasa 42, Rabu 41) padahal tanggalnya maju.
- **Akar masalah**: `buildFinalSnapshot()` memanggil
  `cumulativeVolumeByLineage(locationId)` **tanpa argumen `upToDate`**, sehingga
  kumulatif yang dibekukan = total SELURUH WAKTU (termasuk hari-hari SESUDAH
  laporan itu yang sudah berstatus counted). Jalur non-final (`getKkpDailyData`)
  sudah benar mengirim `reportDate` — jadi selisihnya hanya muncul pada laporan
  yang SUDAH final, yaitu justru yang dicetak & disetor ke KKP.
- **Efek berantai**: `volumeBefore` = `volumeCumulative − volumeToday`
  (turunan, bukan angka independen). Karena `volumeCumulative` sama-sama total
  akhir, "s/d lalu" hanya beda mengikuti besar "hari ini" — 50−8=42 vs 50−9=41.
  Itu penjelasan persis angka yang terlihat.
- **Perbaikan**: `cumulativeVolumeByLineage(report.locationId, report.reportDate)`.
  Rumus `volumeBefore` dipertahankan (sah setelah kumulatif dibatasi tanggal,
  karena satu lokasi hanya punya SATU laporan per tanggal — unik di schema).
- **Bug kedua — urutan baris**: `items` di-`orderBy: { createdAt: "asc" }`, yaitu
  urutan INPUT, sehingga baris berpindah-pindah antar hari (Selasa: Pagar dulu;
  Rabu: Bedeng dulu). Diubah ke `orderBy: { rabNode: { sortOrder: "asc" } }` di
  snapshot builder DAN kedua query — sejalan dengan DECISIONS 140 (urutan RAB).
- **Data lama**: snapshot yang terlanjur beku TIDAK ikut berubah. Disediakan
  `scripts/rebuild-daily-snapshots.mts` (idempoten, dukung DRY_RUN & filter slug)
  untuk membangun ulang dari data laporan yang sama — status/volume/input tidak
  disentuh.
- **BUKAN bug — "Minggu Ke"**: dihitung dari tanggal SPMK dalam blok 7 hari
  (`floor((tanggal − mulai)/7) + 1`), bukan minggu kalender. Dengan SPMK 15 Juli
  2026: 15–21 Juli = Minggu 1, 22–28 Juli = Minggu 2 — karena itu Selasa 21 masih
  Minggu 1 sedangkan Rabu 22 sudah Minggu 2. Sengaja begini supaya SAMA dengan
  penomoran minggu kurva-S/baseline; kalau memakai minggu kalender, "Minggu ke-n"
  di laporan harian akan berbeda dari kurva-S.
- Verifikasi: typecheck ✓ lint ✓ unit 347 ✓ integration 13 ✓ build ✓.

## 148 · 2026-07-27 · Tombol "Bangun ulang snapshot" (bukan skrip, bukan revert final)

- **Kebutuhan**: perbaikan DECISIONS 147 tidak merambat ke laporan yang sudah
  final karena snapshot-nya beku. Skrip CLI tidak praktis — deploy Railway tidak
  menyediakan shell yang mudah dijangkau operator.
- **Keputusan**: sediakan aksi di UI (Sistem → Pemeliharaan data), gate
  `system.manage`, cakupan semua lokasi atau satu lokasi. Menghitung ulang
  `finalSnapshot` dari data laporan yang SAMA — status, volume, dan input tidak
  disentuh. Idempoten, aman diulang, dan diaudit.
- **Sengaja BUKAN "revert dari final"**: dua kebutuhan berbeda. Revert =
  membuka laporan untuk diedit (perubahan domain: progres & kurva-S ikut
  berubah, perlu alasan + histori status). Untuk memperbaiki bug pembekuan,
  revert justru merugikan: harus finalisasi ulang satu per satu untuk 83 lokasi
  × puluhan hari, dan histori status penuh catatan revert padahal datanya benar.
  Revert tetap layak dibangun sebagai fitur tersendiri bila memang dibutuhkan
  (salah input ketahuan setelah final) — belum diputuskan.
- Tersedia juga di production (berbeda dari Zona Berbahaya/Reset yang dikunci
  dev), karena sifatnya koreksi tampilan, bukan penghapusan data.
- `scripts/rebuild-daily-snapshots.mts` dipertahankan untuk pemakaian massal
  lewat CLI, tapi tombol adalah jalur utama operator.
- Verifikasi: typecheck ✓ lint ✓ unit 347 ✓ build ✓.

## 149 · 2026-07-27 · Buka kunci laporan final untuk koreksi (super_admin saja)

- **Kebutuhan** (dari user, terpisah dari bug 147): salah input kadang baru
  ketahuan SETELAH laporan difinalkan. Sebelumnya `final` adalah jalan buntu
  (`REPORT_TRANSITIONS.final = []`) — satu-satunya jalan adalah edit database.
- **Mesin transisi** (CLAUDE.md #5): ditambahkan `final → disetujui` SAJA.
  Tidak ke draft/dikirim/perlu_koreksi — laporan yang sudah lolos review tidak
  perlu mengulang seluruh alur, cukup kembali ke titik sebelum pembekuan.
- **Kapabilitas baru `daily_report.unfinalize`**, hanya super_admin (dikecualikan
  eksplisit dari program_director yang biasanya mewarisi semua). Site manager
  tetap boleh MEMFINALKAN tapi tidak boleh membuka kunci.
- **Wajib alasan** (min. 10 karakter) → tersimpan di `DailyReportStatusHistory`
  + `audit()`. Laporan resmi yang dibuka lagi harus jelas kenapa.
- **`finalSnapshot` dikosongkan** saat dibuka: begitu laporan bisa diedit, angka
  beku itu tidak lagi sah. Dibangun ulang otomatis saat difinalkan kembali.
- **Progres & kurva-S TIDAK berubah** oleh aksi ini — `disetujui` tetap termasuk
  `COUNTED_REPORT_STATUSES`. Yang menggeser angka adalah editan setelahnya, dan
  itu memang niatnya.
- **UI**: tautan kecil "Buka kembali untuk koreksi (super admin)" di panel final,
  tertutup secara default; membuka form berwarna peringatan dengan penjelasan
  konsekuensi + kolom alasan. Sengaja tidak berupa tombol mencolok.
- Verifikasi: typecheck ✓ lint ✓ unit 352 (+5) ✓ integration 13 ✓ build ✓.

## 150 · 2026-07-27 · Manajemen Kontak terpadu + fix kebocoran kontak lintas-tenant

**Gejala (dari user):** "kembali ke chat group, itu kontak yang disimpan masuk
mana, manajemennya dimana? sebaiknya jadikan satu di manajemen kontak."

**Temuan.** MARLIN menyimpan DUA hal berbeda yang sama-sama disebut "kontak",
tersebar di tiga tempat:

| Yang disimpan | Tabel | Cakupan | Dikelola di mana (sebelum) |
|---|---|---|---|
| Tujuan kirim WA | `WaContact` | per-akun (`ownerId`) | `/master/kontak-wa` **dan** `/laporan-wa` (duplikat) |
| Nama pengirim grup | `WaSenderAlias` | se-organisasi (`orgId`) | **tidak ada** — hanya bisa dibuat dari Chat Grup, tidak bisa dilihat/diperbaiki/dihapus |

**Keputusan cakupan** (dikonfirmasi user):

- **Kontak tujuan tetap per-akun.** Super admin (capability baru
  `contact.view_all`, super_admin SAJA) bisa melihat dan merapikan kontak akun
  lain; mutasi atas kontak orang lain diaudit dengan nama pemiliknya.
- **Nama pengirim grup TETAP dipakai bersama se-organisasi.** Alias adalah
  jawaban atas "nomor ini siapa" — faktanya sama untuk semua orang. Kalau
  dibuat per-akun, tiap user harus menamai ulang orang yang sama dan ringkasan
  bisa menyebut nama berbeda untuk orang yang sama tergantung siapa yang
  menekan tombol.
- Tujuan kirim SELALU dibatasi milik sendiri (`listSendableContacts`) walau
  super admin bisa melihat semuanya di halaman kontak.

**Bug yang ditemukan saat menelusuri (bukan permintaan user):**

1. **Kebocoran lintas-tenant.** `buildSenderDirectory` memanggil
   `db.waContact.findMany({ select: … })` **tanpa filter apa pun** — kontak
   pribadi semua akun, bahkan organisasi lain, ikut dipakai menamai pengirim
   grup. Diperbaiki jadi `where: { owner: { orgId } }`.
2. **Tidak ada foreign key.** `owner_id` / `org_id` / `created_by_id` cuma UUID
   lepas, jadi filter per-organisasi memang tidak mungkin dan baris yatim tidak
   pernah ikut terhapus. Migration `20260727120000_contact_relations` memasang
   FK (kontak → user CASCADE, alias → org CASCADE, alias → pembuat SET NULL)
   setelah membersihkan baris yatim.
3. **Nomor `0…` tersimpan apa adanya.** `normalizeWaTarget("0812…")` menghasilkan
   `081234567890@c.us`; WhatsApp hanya mengenal format internasional, jadi
   kiriman gagal SENYAP dan baru ketahuan saat laporan tidak sampai. Sekarang
   `0…`/`8…` dinormalisasi ke `62…`, kode negara ganda dirapikan.

**Perubahan:**

- Halaman baru `/master/kontak` (tab Master Data "Kontak") berisi dua bagian:
  kontak tujuan kirim (tambah/ubah/hapus + pencarian + panel "kontak akun lain"
  untuk super admin) dan nama pengirim grup (ubah nama/peran/catatan, lepas
  nama, tampil "dinamai oleh"). URL lama `/kontak-wa` & `/master/kontak-wa`
  redirect ke sini.
- Modul baru `src/lib/contacts/`: `model.ts` (murni — normalisasi tujuan,
  bentuk senderKey, pencarian), `queries.ts` (aturan cakupan dipaksakan di satu
  tempat), `actions.ts` (CRUD kontak + edit/hapus alias, semua `requireCapability`
  + `audit`).
- `/laporan-wa` tidak lagi mengelola kontak — hanya menampilkan daftar tujuan
  milik sendiri + tautan ke halaman kontak. Chat Grup menautkan ke sana setelah
  menyimpan nama pengirim.
- Duplikasi `addWaContactAction`/`deleteWaContactAction`/`normalizeWaTarget` di
  `exec-report/actions.ts` dihapus (pindah ke modul kontak).

**Yang sengaja TIDAK dilakukan.** Alias tidak dijadikan per-akun (lihat alasan
di atas), dan alias lama tidak diubah kepemilikannya.

**Verifikasi:** typecheck ✓ · lint ✓ · unit 367 ✓ · integration 13 ✓ · build ✓ ·
uji browser: super admin melihat kontak akun lain & normalisasi `0812…` →
`6281…`; site_manager TIDAK melihat kontak akun lain tetapi tetap melihat alias
se-organisasi.

## 151 · 2026-07-27 · Satu formula prestasi untuk laporan, kurva-S, dan dashboard

**Pemicu (dari user):** "periksa juga laporan mingguan. jangan sampai ada
kesalahan lagi."

Audit dilakukan dengan menulis uji integrasi invarian lebih dulu
(`tests/integration/periodic-report.test.ts`), bukan dengan membaca kode saja.
Tiga uji langsung merah.

### Temuan 1 — baris blanko KKP tidak jumlah

`prestasi()` dipanggil TERPISAH untuk tiap kolom, masing-masing dibatasi 100%:

```
prestasiLalu = min(100, volLalu/vk × 100)
prestasiIni  = min(100, volIni /vk × 100)   ← salah
prestasiSd   = min(100, volSd /vk × 100)
```

Begitu volume kumulatif melampaui volume RAB, "lalu + ini" jadi lebih besar
dari "s/d". Contoh terukur di uji: vk 100, lalu 50, ini 60 →
`bobotLalu + bobotIni = 17,09` sedangkan `bobotSd = 15,54`. Baris tidak jumlah
di dokumen yang diteken PPK.

Jalur nyatanya bukan salah input (form harian sudah menolak volume melebihi
sisa RAB), melainkan **adendum yang MENGURANGI volume setelah laporan ada** —
realisasi lama mendadak melebihi volume kontrak yang baru.

**Perbaikan:** pembatas 100% hanya dipasang pada KUMULATIF; kolom periode
diturunkan dengan pengurangan (`prestasiIni = prestasiSd − prestasiLalu`),
persis pola laporan harian di DECISIONS 147. Kolom volume tetap mentah — itu
fakta lapangan; yang dibatasi hanya persentasenya.

### Temuan 2 — satu halaman, dua angka realisasi

Total kolom "bobot s/d" di tabel dihitung dari **volume × bobot revisi aktif**,
sedangkan kurva-S & deviasi di halaman yang SAMA dihitung dari **Σ valueDone**.
Dua basis berbeda untuk hal yang sama. Terukur di uji: tabel 40,34% vs kurva
41,90%.

`valueDone` dibekukan memakai harga satuan revisi yang aktif SAAT laporan
dibuat. Jadi selain kasus pembatas 100%, **setiap adendum yang mengubah harga**
membuat kedua angka melenceng tanpa ada yang salah input.

**Perbaikan:** kurva-S dihitung dari volume + bobot revisi aktif, dan
`actualPct` laporan = total kolom "bobot s/d" tabel. Satu perhitungan, satu
angka.

### Temuan 3 — dashboard tidak sepakat dengan laporan resmi

`progress.ts` (yang dokumennya sendiri menyebut diri "SATU sumber") memakai
`Σ value_done`, tanpa pembatas dan dengan harga beku. Terukur: dashboard 72,97%
vs blanko KKP 71,41%; dengan harga beku 3× selisihnya jadi **9 poin**.

**Perbaikan:** `realized` di SQL jadi
`Σ LEAST(1, Σvolume/volumeRAB) × amount` atas item revisi AKTIF — identik
dengan blanko KKP. Ikut memperbaiki `installedValue` di modul keuangan yang
memakai angka yang sama.

### Temuan 4 — laporan harian tidak membatasi 100% sama sekali

`pctCumulative` = `volumeCumulative / volumeContract × 100` tanpa `min(100)`,
sehingga item yang sama bisa tampil 110% di blanko harian tapi 100% di blanko
mingguan.

**Perbaikan:** memakai `prestasiPct` yang sama.

### Perubahan

- Modul baru **`src/lib/progress-calc.ts`** (murni, tanpa DB): `prestasiPct`,
  `itemAchievement`, `realizedPctFromItems`, `bobotPct`. Ini satu-satunya
  tempat formula prestasi/bobot boleh ditulis.
- Dipakai oleh: `periodic-report.ts` (tabel + kurva), `progress.ts` (dashboard,
  portofolio, keuangan), `daily-report/{service,queries}.ts` (blanko harian),
  `plan/suggest.ts` (deviasi di panel saran, sebelumnya versi ketiga lagi).
- Excel, PDF, dan komponen cetak sudah memakai objek `PeriodReport` yang sama,
  jadi ikut terkoreksi tanpa perubahan.

### Dampak angka setelah deploy

Realisasi % bisa **turun sedikit** di lokasi yang (a) punya adendum pengurang
volume, atau (b) punya adendum pengubah harga. Itu koreksi, bukan kemunduran:
angka yang sekarang tampil adalah angka yang sama dengan blanko KKP.

### Verifikasi

- Uji integrasi baru: **16 invarian** — kolom berjumlah, "s/d" tidak pernah
  mundur antar minggu, "lalu" minggu n = "s/d" minggu n−1, urutan kategori &
  baris ikut RAB, Σ bobot = 100, tabel = kurva, dashboard = laporan, termasuk
  kasus volume melebihi kontrak dan harga beku.
- Uji unit baru: 18 untuk formula murni.
- typecheck ✓ · lint ✓ · unit 384 ✓ · integration 29 ✓ · build ✓
- Uji browser: `/cetak/periodik/.../mingguan/21`, blanko harian, `/progress`,
  dan beranda semuanya 200.

**Catatan performa (bukan bagian perbaikan):** halaman cetak mingguan lokasi
dengan 1657 baris butuh ~22 detik di mode dev. Perhitungannya sendiri 55–129 ms
— sisanya render React di dev. Belum diukur di produksi; dicatat di
`docs/OPEN_ISSUES.md`.

## 152 · 2026-07-27 · Calculation Integrity Protocol dijalankan atas kode

**Pemicu:** user memberikan `CLAUDE_CODE_CALCULATION_INTEGRITY_PROTOCOL.md` dan
meminta protokolnya dijalankan, bukan sekadar dibaca.

### Pelanggaran yang ditemukan & dibereskan

**1. Kurva-S KETIGA di `lib/baseline.ts` (`getScurveSeries`).** Dipakai
ringkasan lokasi, halaman Progress, dan `lib/forecast.ts`. Menghitung realisasi
dari `Σ valueDone ÷ grandTotal`, tanpa pembatas 100% dan dengan harga beku —
jadi berbeda dari kurva blanko KKP untuk lokasi yang sama. Diubah ke basis
volume + bobot revisi aktif lewat `progress-calc.ts`.

**2. `COUNTED_REPORT_STATUSES` ditulis ulang sebagai literal di 5 tempat**
(`daily-report/queries.ts` ×2, `ai-hub/source.ts` ×2, `dashboard.ts`). Kalau
level status diubah, kelimanya mengambang diam-diam. Semua diganti memakai
konstanta kanonik; dua raw SQL diparameterkan
(`dr.status::text = ANY(${[...COUNTED_REPORT_STATUSES]}::text[])`).

**3. Dokumen vs kode (STOP condition).** `PROJECT.md` masih menyebut formula
lama pasca DECISIONS 151 — pelanggaran yang dibuat sendiri. `PROJECT.md`
ditulis ulang dengan tabel calculation layer + formula kanonik + daftar
invarian. `docs/rebuild/DATA_MODEL_AUDIT.md` (arsip sistem lama) diberi kotak
peringatan bahwa dua formulanya sengaja tidak lagi berlaku.

**Yang diperiksa dan ternyata SUDAH benar:** AI Hub tidak menghitung realisasi
sendiri — `ai-hub/source.ts` memakai `getLocationsProgress` (`realizedPct` /
`deviationPct`); Excel, PDF, dan komponen cetak memakai objek `PeriodReport`
yang sama; query over-volume di `ai-hub/source.ts` memang detektor, bukan
perhitungan progress.

### Gate yang sekarang dijaga uji otomatis

- **Reconciliation gate**: dashboard = kurva ringkasan lokasi = blanko KKP
  mingguan; panel saran rencana memakai deviasi yang sama; kurva lokasi tidak
  pernah > 100%.
- **Date-as-of gate**: laporan minggu n tidak melihat realisasi minggu n+1;
  batas tanggal periode benar; laporan periode lampau stabil terhadap "hari
  ini".
- **Revision & lineage gate**: adendum yang membuang item — revisi lama
  di-supersede, bukan dihapus (foreign key laporan melindunginya) — membuat
  lineage-nya keluar dari realisasi aktif tanpa menghapus histori, dan tidak
  menggelembungkan persentase ketika basisnya mengecil.
- **Fixture emas** dengan hitungan manual: RAB Rp100.000.000, realisasi 10 dari
  100 unit → `realizedValue` Rp10.000.000 / 10,00%; draft tidak dihitung;
  dikirim/disetujui/final menghitung sama; grandTotal 0 tidak menghasilkan
  NaN/Infinity; dua lokasi satu paket tidak tercampur.

Total uji integrasi laporan: **28**.

### Yang SENGAJA tidak dikerjakan (butuh keputusan user)

Dicatat di `docs/OPEN_ISSUES.md` dengan format konflik protokol:

1. **Level status belum dipisah** — protokol menuntut reportedProgress /
   verifiedProgress / frozenProgress dan melarang label generik "Realisasi".
   Sistem punya satu level. Mengubahnya diam-diam persis yang dilarang
   protokol, dan opsi paling benar (basis = terverifikasi) menurunkan seluruh
   angka historis sehingga blanko yang sudah dikirim ke KKP tidak lagi cocok.
2. **`dataAsOf` belum melekat di setiap angka** — hanya AI Hub Pulse yang
   punya. Ini soal ketertelusuran, bukan kebenaran: laporan periodik memakai
   batas periode eksplisit dan sudah diuji stabil terhadap "hari ini".

### Verifikasi

typecheck ✓ · lint ✓ · unit 384 ✓ · integration 41 ✓ (28 di antaranya laporan
periodik) · build ✓ · E2E 16 ✓.

`docker build --no-cache` TIDAK dapat dijalankan di lingkungan kerja ini —
tarikan image Docker Hub diblokir proxy (403 dari cloudfront). Gate itu
dijalankan oleh job "Docker build" di CI, bukan lokal; jangan dianggap terbukti
sampai CI hijau.

## 153 · 2026-07-27 · Tindak lanjut audit independen + dokumentasi dirapikan

**Pemicu:** user memberikan `AUDIT_MARLIN_DEV_20260727.md` (audit independen,
berbasis pembacaan tanpa menjalankan perintah apa pun) dan meminta temuannya
diverifikasi lalu diperbaiki bila memang benar.

### Temuan yang TERBUKTI dan diperbaiki

**C1 · Tidak ada constraint satu revisi aktif per lokasi.** Query realisasi
JOIN ke `rab_revisions … status='aktif'`; dua revisi aktif = fan-out = realisasi
DOBEL, tanpa error. `activateRevision` memang sudah atomik di `$transaction`,
tetapi dua transaksi bersamaan pada isolation level default masih bisa lolos —
disiplin kode saja tidak cukup. Migration `20260727140000_one_active_per_location`
memasang partial unique index pada `rab_revisions` DAN `baselines` (masalah yang
sama persis), setelah merapikan duplikat yang mungkin sudah ada (pertahankan
nomor tertinggi). Diverifikasi: Prisma TIDAK menganggap partial index sebagai
drift, jadi `migrate diff` tetap bersih.

**H2 · Paritas SQL ↔ TS.** `prestasiPct` (TS) meng-clamp ke 0; SQL hanya punya
`LEAST(1.0, …)` tanpa batas bawah, dan `NULLIF(volume, 0)` tidak menangkap
volume negatif. Diperbaiki jadi
`GREATEST(0.0, LEAST(1.0, Σvol / NULLIF(GREATEST(volume,0), 0)))` + uji paritas.

**H3 · Protokol tidak ada di repo.** Prompt auditor menunjuk
`docs/rebuild/CALCULATION_INTEGRITY_PROTOCOL.md` yang tidak pernah ada.
Disimpan di repo DENGAN tabel contract yang sudah dikoreksi — versi aslinya
masih memuat `realizedValue = Σ valueDone` yang batal sejak DECISIONS 151, dan
kalau dibiarkan, pembaca berikutnya akan "memperbaiki" kode agar cocok dengan
dokumen yang salah.

**H4 · Tiga besaran berbeda bernama sama.** `keuangan/page.tsx` memakai
`realizedPct = pct(expenseApproved, budgetTotal)` — itu **serapan biaya**,
bukan progress fisik — dan melabelinya "Realisasi". Di halaman lokasi yang sama
seseorang bisa membaca "Realisasi 45%" (biaya) dan "Realisasi 71%" (fisik) lalu
menyimpulkan deviasi yang tidak ada. Diganti `serapanBiayaPct` / "Serapan
Biaya" / "Realisasi Biaya".

**H5 · pnpm 11.13.0 adalah rilis RUSAK menurut vendornya sendiri** (`npm view
pnpm@11.13.0 deprecated` → "This is a broken version. Please install pnpm
v11.13.1 or newer"). Dinaikkan ke 11.17.0; lockfile TIDAK berubah.

**M6 · Formula bisnis di React component.** `gapValue` + fallback
`unitPrice = amount / volume` dipindah ke `progress-calc.laggingItems()`.
Fallback itu mengarang harga satuan yang tidak ada di dokumen RAB; diganti
proporsi terhadap `amount`.

**M10 · CI tidak berjalan pada push ke `dev`.** DITOLAK setelah dicoba.

Menambahkan `dev` ke trigger `push` membuat setiap commit memicu DUA event
(push + pull_request) sehingga CI berjalan dobel. Upaya menutupnya dengan
`concurrency: ci-${{ github.sha }}` gagal diam-diam — pada event
`pull_request`, `github.sha` adalah SHA merge-commit bikinan GitHub, bukan SHA
commit yang di-push, jadi kedua run tidak pernah masuk grup yang sama (terbukti
8 check untuk satu commit). Diperbaiki ke
`pull_request.head.sha || github.sha`: dedup berhasil (run push dibatalkan
dalam 2 detik), TETAPI setiap PR jadi memampang 4 check *cancelled* di samping
4 yang hijau.

Ditimbang ulang: trigger itu hanya menutup celah "push ke `dev` sebelum PR
dibuat" — jendela beberapa menit dalam alur yang selalu berujung PR. Harganya
noise permanen di setiap PR. Trigger `push` dikembalikan ke `[main]` saja.

Yang DIPERTAHANKAN dari percobaan ini: blok `concurrency` dengan grup per-PR
(`github.event.pull_request.number || github.ref`). Ini membatalkan run yang
sudah usang ketika ada push baru ke PR yang sama — manfaat nyata yang tidak ada
sebelumnya, tanpa efek samping.

**L8 · PPN selalu dibulatkan ke bawah** (pembagian BigInt memotong). Diganti
half-up, simetris untuk nilai negatif.

**M7/M8 · Uji yang bolong.** Ditambahkan: siklus koreksi dihitung sekali,
paritas SQL↔TS, Σ amount kategori = Σ amount item, constraint revisi/baseline
ganda, pembulatan PPN.

### Temuan yang KELIRU — tidak diubah

- **#13 "volume > kontrak tidak ada test penolakan"** — ada, sejak awal:
  `daily-report-flow.test.ts` "guard: volume kumulatif melebihi volume RAB
  ditolak".
- **#15 "PPN tanpa test"** — `money.test.ts` punya 4 case `contractMismatch`
  plus `ppnAmount`/`withPpn`. Auditor tampaknya mencari string "ppn" huruf
  kecil dan tidak menemukan `ppnAmount`.
- **M9 "`new Date()` sebagai fallback startDate tidak ditandai"** — `new Date()`
  di `periodic-report.ts:199` hanya hidup di cabang `assume` (khusus pratinjau
  jadwal sebelum SPMK), dan di `:463` untuk membatasi kolom minggu di DEPAN
  minggu berjalan. Laporan periodik resmi tidak memakainya. Yang benar dari
  temuan ini hanyalah: flag `assumed` tidak diteruskan ke output — dicatat di
  OPEN_ISSUES sebagai 🟢.

### Temuan yang BENAR tapi sengaja tidak dikerjakan

M5 (`dataAsOf` pada `getLocationProgress`), L9/L10 (keseragaman pembulatan),
paritas PDF/Excel/WA/AI, dan pemisahan level status — semuanya butuh keputusan
user atau refactor lintas modul. Dicatat di `docs/OPEN_ISSUES.md`.

**M4 (`dev` tidak lagi mendahului `main`)** bukan temuan kode: itu konsekuensi
normal setelah PR di-merge. Alur yang berlaku tetap `dev` → PR → `main`.

### Dokumentasi dirapikan

- **`docs/README.md` baru** — peta navigasi: mana yang HIDUP, mana ARSIP, dan
  aturan merawat dokumentasi.
- **`PERMISSION_MATRIX.md` sekarang DIBANGKITKAN** dari `src/lib/authz.ts`
  (`pnpm docs:permission`), dijaga `tests/unit/permission-matrix-doc.test.ts`.
  Sebelumnya tertinggal 43 vs sebagian kecil capability yang tercatat — persis
  jenis dokumen yang tidak boleh ditulis tangan.
- **`TEST_PLAN.md` ditulis ulang** memisahkan "sudah ada" (angka nyata: 31
  berkas unit / 390 case, 4 integration / 47 case, 1 E2E / 16 case) dari
  "direncanakan". Versi lama membaca seolah 9 skenario E2E sudah ada padahal
  baru autentikasi.
- **`SESSION_LOG.md` DIHAPUS** — berhenti diperbarui berbulan-bulan, dan
  entri terakhirnya mengklaim menghapus `DEPLOY_RAILWAY.md` yang nyatanya masih
  ada. `DECISIONS.md` sudah menjadi log yang sebenarnya.
- **11 artefak rebuild diberi banner ARSIP** supaya tidak terbaca sebagai
  spesifikasi berjalan.
- `TECHNOLOGY_AUDIT.md` (pnpm), `OPEN_ISSUES.md` (konvensi + temuan baru,
  entri `dataAsOf` ganda digabung), `CLAUDE.md`, dan `README.md` diselaraskan.

### Verifikasi

typecheck ✓ · lint ✓ · unit 390 ✓ · integration 47 ✓ · build ✓ · E2E 16 ✓.
`docker build --no-cache` tetap tidak dapat dijalankan di lingkungan kerja
(tarikan Docker Hub diblokir proxy) — dibuktikan job Docker build di CI.

## 154 · 2026-07-27 · Eksekusi P0 audit total (B1, B2, B4, B6, B9, B8, UI-konfirmasi)

**Pemicu:** user memberikan `AUDIT_TOTAL_MARLIN_20260727.md` (audit menyeluruh —
kalkulasi + UI/UX, dijalankan dengan test hijau di lingkungan auditor) dengan
perintah "cek dan eksekusi". Semua temuan P0 diverifikasi ke kode dulu —
seluruhnya TERBUKTI — lalu dieksekusi. Keputusan bisnis (bagian I audit) tidak
diputuskan sendiri; dicatat di OPEN_ISSUES.

### B1 (CRITICAL) — guard volume harian bisa ditembus tanpa race

Guard "kumulatif ≤ volume RAB" hanya berjalan saat item DISIMPAN, dan hanya
melihat laporan yang sudah counted. Dua draft di dua tanggal masing-masing
lolos, lalu keduanya dikirim — kumulatif melampaui RAB tanpa error. Jalur yang
sama terbuka lewat `perlu_koreksi`.

**Fix:** `assertVolumeWithinRab()` — re-validasi DI DALAM transaksi transisi
`→ dikirim`: kumulatif counted laporan LAIN + item laporan ini ≤ volume RAB.
Pesan error menyebut item dan sisa. Regresi: dua draft dua tanggal → submit
kedua ditolak, status tetap draft, koreksi ke sisa yang sah lolos.

### B2 (CRITICAL) — blanko harian jalur LIVE menampilkan >100%

`getKkpDailyData` jalur live menghitung `vol/volK×100` tanpa cap — situs
KETIGA rumus ini; dua lainnya sudah dibetulkan DECISIONS 151, yang ini terlewat.
Item over-volume tampil 110% di pratinjau/PDF/Excel harian, 100% di blanko
mingguan. **Fix:** `prestasiPct`. Regresi: item 110/100 → `pctCumulative` 100,
volume mentah tetap 110 (fakta lapangan tidak disembunyikan).

### B4 (HIGH) — label "terverifikasi" palsu di keuangan

`installedValue` = level COUNTED (dikirim+disetujui+final) tetapi dilabeli
"nilai terpasang terverifikasi" di `/keuangan`, dan `unbilledWork` menamai
parameternya `installedVerified`. **Fix label** (basis TIDAK diubah — itu
keputusan user): "dilaporkan (dikirim+disetujui+final) — belum tentu
terverifikasi"; param → `installedReported`; jsdoc dikoreksi.

### B6 (HIGH) — race double-payment

`addPayment`/`addDisbursement`/`createExpense` = aggregate→guard→create pada
READ COMMITTED; dua request paralel sama-sama lolos guard → kas keluar dobel,
disembunyikan clamp `0n`. **Fix:** lapisan baru `lib/finance/apply.ts`
(`applyPaymentTx`/`applyDisbursementTx`) dengan `SELECT … FOR UPDATE` pada
baris induk sebelum agregasi; `createExpense` mengunci baris komitmen dengan
pola sama. Regresi konkurensi NYATA: dua pembayaran paralel 60jt atas invoice
100jt → tepat satu ditolak, total tersimpan 60jt; idem pencairan termin.

### B9 (HIGH) — scope bocor di jalur baca AI

Jalur generate ketat (`resolveAiScope`), jalur baca hanya cek `ai.view`.
**Fix:** `lib/ai-hub/read-scope.ts` (`scopeCoveredBy` — murni, diuji): user
boleh membaca run/artefak hanya bila SEMUA `scopeIds` run tercakup izinnya;
scope kosong/korup = tolak untuk role scoped. Diterapkan di **7 jalur** (audit
menyebut 4): halaman run, daftar artefak, route Excel, halaman cetak, plus
`/ai/history` dan 3 action lifecycle artefak (transisi/edit/distribusi) yang
sekelas bocornya. Respons 404/"tidak ditemukan", bukan 403 — keberadaan tidak
dikonfirmasi.

### B8 (HIGH, kecil) — TOTAL bobot PDF hardcode 100

Diganti Σ `subtotalBobot` nyata — PDF tidak boleh bercerita lain dari
layar/Excel pada kasus kategori-tanpa-item.

### UI-P0 — konfirmasi untuk persetujuan keuangan

Primitif dialog PERTAMA di repo: `ui/confirm-dialog.tsx` (`ConfirmSubmit`) —
role=dialog + aria-modal, focus trap, Escape menutup, fokus dipulihkan ke
pemicu (pola APG). Dipakai tombol **Setujui** di antrean approval `/keuangan`
dan panel lokasi; dialog menyebut jenis + nomor + nominal transaksi. Tombol
pembuka **Tolak** diturunkan ke `secondary` (bukan danger filled berdampingan
primary) — aksi finalnya tetap lewat form alasan. Diverifikasi browser: klik
pertama TIDAK menyetujui apa pun, Escape menutup, konfirmasi menyetujui.

### Temuan audit yang DIPERIKSA dan DITOLAK

**B16a** (`rebuildFinalSnapshots` tanpa `requireLocationAccess`): gate-nya
`system.manage` = super_admin SAJA, plus filter `orgId` — `requireLocationAccess`
untuk super_admin selalu lolos, jadi "kaki tripod yang hilang" tidak berdampak.
Tidak diubah.

### Verifikasi

typecheck ✓ · lint ✓ · unit **394** ✓ · integration **52** ✓ (finance-race
baru: 3) · build ✓ · uji browser dialog konfirmasi ✓.

Sisa temuan audit (P1/P2 + UI) dan 3 keputusan baru dicatat di OPEN_ISSUES.

## 155 · 2026-07-27 · Eksekusi P1/P2 audit total — keuangan best-practice, konsistensi angka, guard, UI

**Konteks.** Lanjutan DECISIONS 154. Instruksi user: fitur keuangan tidak perlu
menunggu keputusan bisnis — perbaiki menurut best practice; sisanya (konsistensi
angka, guard, UI) diselesaikan sekalian. Semua ID mengacu laporan
AUDIT_TOTAL_MARLIN_20260727.

### Keuangan (best-practice defaults, bisa direvisi user)

- **B5 — PPN apel-ke-apel.** `unbilledWork(installedReportedPreTax, billed,
  ppnPercent)` kini meng-gross-up terpasang ke incl-PPN via
  `withPpn(…, Contract.ppnPercent)` sebelum dikurangi billing (incl-PPN).
  Dulu pre-PPN dikurangi incl-PPN → "belum tertagih" understated ~PPN%.
  Basis level status TETAP counted (menunggu KEPUTUSAN level status).
- **B14a — retensi billing draft tidak dihitung**: `getContractsBilling`
  mengakumulasi `retentionHeld` hanya untuk status non-draft.
- **B14b — ambang `cair` memperhitungkan retensi**: pencairan lunas ketika
  `received ≥ amount − retentionHeld` (dulu `≥ amount` → termin ber-retensi
  tak pernah "cair").
- **B14c — validasi silang retensi kontrak**: `createOwnerBilling` menolak
  `retentionHeld` > ceil(amount × `Contract.retentionPercent`%). Lebih KECIL
  boleh — kontrak KNMP mengizinkan retensi diganti jaminan pemeliharaan.
- **B15 — four-eyes.** `assertFourEyes` di approve komitmen/expense/invoice/
  billing: pengaju tidak boleh menyetujui transaksinya sendiri. Break-glass:
  super_admin BOLEH self-approve tetapi flag `selfApprove: true` masuk audit
  log (jejak, bukan larangan — tim kecil butuh jalan darurat).

### Konsistensi angka

- **B13 — satu agregat kanonik.** `weightedRealizedPct`/`weightedPct` di
  `progress-calc.ts` menggantikan 4 fork (dashboard, /progress, /paket, gate
  serah_terima) yang beda penanganan div-0 & pembulatan.
- **B12 — panel saran se-basis laporan resmi.** grandTotal = Σ amount kategori
  + bobot dari `amount` (dulu Σ vol×harga = basis "Realisasi" keempat);
  toleransi test dikencangkan kembali ke 2 desimal.
- **B3 — kurva resmi satu basis.** `updateBaselinePoints` menyalin
  `scheduleItems` dari baseline acuan (bila jumlah minggu sama) sehingga
  dokumen KKP hal-1 (kurva) dan hal-2 (matriks) tidak bercerita beda setelah
  edit manual; `buildKurvaSheet` menerima `planCumOfficial` (points resmi)
  sebagai baris kumulatif rencana, mingguan = selisihnya.
- **B7 — Excel berhenti di cutoff.** Baris realisasi/deviasi & seri chart
  hanya sampai minggu laporan terakhir (dulu carry-forward sampai akhir
  kontrak, beda dari layar/PDF).

### Guard

- **B16b** — enrichment (isu/cuaca/foto) pada laporan `dikirim` kini butuh
  `daily_report.review`; pembuat hanya di `draft`/`perlu_koreksi`.
  **B16c** — `addIssueFromReport` menolak laporan `final`.
- **B11 — scope org.** `lib/auth/scope.ts` (`locationScopeWhere`): role
  lintas-lokasi (`locIds === null`) difilter `package.orgId` di beranda,
  progress, keuangan, lokasi, laporan, hari-ini, dokumen, dashboard, peta.
  Dorman selama single-org, meledak saat org kedua — ditutup sekarang.
- **B18 — kuota AI.** Hitungan harian org difilter user se-org (AiRun tidak
  punya relasi user → two-step `orgUserIds`); batas hari = midnight
  Asia/Jakarta (`jakartaDateKey`), bukan midnight server.
- **B19 — dataAsOf jujur.** `dataAsOf` = watermark data (max `updatedAt`
  laporan/kegiatan dalam scope; null bila kosong), ditampilkan WIB — bukan
  jam render yang menyulap data basi jadi terlihat segar.
- **B10 — validasi klaim AI sadar-tanda.** Deviasi −8% tidak lagi tervalidasi
  oleh +8% resmi; `sections[].body` ikut dicek (section gagal DIBUANG per
  kontrak PROJECT.md §5a); `waSummary` gagal-cek dikosongkan + `droppedNote`.
- **B17 — adendum tidak menghilangkan realisasi diam-diam.** (1) Pratinjau
  impor menampilkan PERINGATAN daftar item ber-realisasi yang tidak ditemukan
  di file baru (pilihan best-practice: warning, bukan blokir — adendum resmi
  memang boleh menghapus item). (2) Kegagalan `regenerateBaseline` SETELAH
  revisi aktif dilaporkan apa adanya ("revisi SUDAH AKTIF, kurva-S gagal —
  tekan Hitung ulang"), bukan error generik seolah impor batal. Penyatuan ke
  satu transaksi DB di-defer (OPEN_ISSUES).

### UI (quick wins; defer dicatat di OPEN_ISSUES)

- Tombol submit `/masuk` & `/ganti-password` + "Terapkan" `/foto` → primitif
  `Button`; hover `opacity-90` terakhir diganti token.
- `CardHeader`: `flex-wrap` + slot aksi `min-w-0` — di 390px aksi melipat ke
  bawah, judul tidak terpotong ("K S"). Overflow horizontal
  `/lokasi/[slug]/progress` @390px = 0px (diverifikasi browser).
- **Peredam prognosa**: `forecast.ts` horizon = akhir kontrak + 52 minggu;
  proyeksi yang jatuh melewatinya (SPI≈0 → "16 Apr 2086, telat ~3115 mgg")
  tampil "Belum bisa diperkirakan — laju terlalu rendah", status tetap
  "telat", `projectedPctAtEnd` tetap dihitung. Unit test 2 arah (diredam vs
  telat moderat tetap tampil).
- `useDismissable` (ui): Escape + pemulihan fokus utk drawer ad-hoc — dipakai
  drawer menu bottom-nav & drawer sumber Pulse. Diverifikasi browser: Escape
  menutup, fokus kembali ke pemicu.

### Verifikasi

typecheck ✓ · lint ✓ · unit **396** ✓ (forecast damper baru: 2) · integration
**52** ✓ · build ✓ · browser: keuangan (label + antrean), progress desktop
(damper aktif di data seed), progress @390px (overflow 0), drawer Escape ✓.

## 156 · 2026-07-27 · Laporan mingguan: Excel tertaut ke rincian + header tabel blanko KKP

**Permintaan user.** (1) Baris "Realisasi Prestasi %" di sheet kurva-S Excel
selama ini angka tempelan — harus TERTAUT ke detail laporan di rincian,
terutama minggu aktif. (2) Header tabel rincian harus mengikuti blanko KKP.

### Tautan Excel (satu rantai rumus sampai kurva)

- Sheet **Laporan**: subtotal kategori = rumus `SUM(...)` atas baris item;
  baris **JUMLAH** = penjumlahan sel subtotal. Nilai cache = angka resmi
  aplikasi, jadi pembaca tanpa recalc melihat angka yang sama.
- Sheet **Kurva S**: sel "Realisasi Prestasi %" **minggu laporan** =
  `=Laporan!K<JUMLAH>` (total "Bobot Minggu ini"). Baris kumulatif & grafik
  sudah membaca baris itu → tautan menjalar sampai kurva. Hanya laporan
  MINGGUAN (bulanan mencakup >1 kolom minggu, tak bisa dipetakan ke satu sel);
  minggu di luar cutoff realisasi tetap kosong (B7 dipertahankan).

### Header blanko KKP (layar + Excel)

`No | Uraian Pekerjaan | Volume Kontrak | Satuan | Bobot | Realisasi Pekerjaan
{Minggu Lalu / Minggu ini / S-d Minggu ini × Volume, Prestasi, Bobot} |
Bobot Rencana | Sisa Pekerjaan {S-d Minggu ini: Prestasi, Volume}` — 3 baris
merge. Kolom "Harga Satuan" DIBUANG (tidak ada di blanko; sering kosong di RAB
impor). Kolom Bobot per kelompok memakai `bobotLalu/bobotIni/bobotSd` yang
sudah ada (kolom selalu menjumlah, DECISIONS 151).

### Kolom baru "Bobot Rencana" (per item)

Jadwal rencana disimpan per KATEGORI (DECISIONS 103), maka rencana per item =
bobot × fraksi rencana kategorinya (`planFractionFromWeekly`, progress-calc).
**Gate rekonsiliasi**: Σ matriks kategori boleh beda tipis dari titik baseline
resmi (mis. setelah edit manual titik, B3) — supaya satu dokumen tidak
menampilkan dua angka rencana, kolom didistribusikan via `distributeWithCaps`
(waterfilling, plafon = bobot item) sehingga **JUMLAH kolom == planPct resmi
persis**; bentuk antar-kategori tetap mengikuti matriks. Uji integrasi
menuntut `totals.bobotRencana ≈ planPct` (6 desimal) tiap minggu + monoton +
per-item ≤ bobot.

### Verifikasi

typecheck ✓ · lint ✓ · unit **405** (planFractionFromWeekly 4 + 
distributeWithCaps 5) · integration **53** (kolom Bobot Rencana + rekonsiliasi)
· build ✓ · file .xlsx nyata dibongkar: `E25 = Laporan!K1704` (minggu 2),
`K1704 = K73+K107+…` (rantai subtotal), `O JUMLAH = 22,40` == rencana resmi
minggu 2 ✓ · tampilan layar diverifikasi browser.

---

## 157 · 2026-07-27 · Kolom Bobot kurva-S = SUM kolom minggu; sebaran wilayah dashboard = populasi peta

### Kolom "Bobot (%)" bukan lagi angka tempelan

Permintaan user: kolom bobot di sheet Kurva S adalah penjumlahan sel minggu di
barisnya. Excel kini menulis `=SUM(D{r}:{kolom minggu terakhir}{r})` per baris
kategori (cache = bobot kategori), dan baris "Kumulatif Rencana" memuat
`=SUM(C{baris pertama}:C{baris terakhir})` menggantikan teks "100,00" statis di
layar/PDF. Baris rencana per minggu **tetap** memakai kurva baseline resmi
(B3) — jadwal kategori adalah rincian, mengeditnya di Excel tidak menggeser
kurva resmi.

### Pembulatan penjaga-jumlah (`allocateRounded`, kkp-sheet.ts)

Kalau tiap sel minggu dibulatkan sendiri-sendiri (3 desimal), `=SUM(...)` bisa
meleset dari bobot resmi kategori — kolom yang seharusnya menjumlah malah
menampilkan 4,32 di tempat 4,33. Angka TAMPIL karena itu dialokasikan sekali di
calculation layer dengan metode sisa terbesar: `weeklyShown` (3 desimal)
menjumlah persis ke `bobotShown` (2 desimal), dan Σ `bobotShown` = total tabel.
Total dipatok 100,00 **hanya** bila selisih jadwal terhadap 100 sebatas galat
pembulatan (≤0,05); jadwal yang memang belum menutup 100% ditampilkan apa
adanya. Minggu bernilai 0 tidak pernah menerima alokasi — jeda tetap jeda.
Layar/PDF dan Excel memakai `weeklyShown`/`bobotShown` yang sama.

### Sebaran wilayah dashboard: satu populasi dengan peta

Temuan user: kartu wilayah menampilkan Jawa 46, sisanya 0, padahal pin NTB/Bali
jelas ada di peta. Sebabnya bukan ejaan provinsi melainkan **dua populasi dalam
satu layar**: kartu menghitung `isActive: true` (lokasi berjalan), sedangkan
peta menggambar semua lokasi ber-GPS termasuk lokasi target yang belum mulai.
Keputusan user: kartu wilayah memotret **seluruh lokasi**, dan peta membedakan
lokasi belum mulai. Perubahan:

- `regions` dihitung dari query lokasi tanpa filter `isActive` (KPI submit
  harian tetap atas lokasi berjalan, labelnya sudah "Aktif dipantau").
- `MarkerTone` bertambah `idle` = belum mulai; pin digambar **berongga** dan
  lebih kecil, dengan legenda "Belum mulai (target)". Filter "Belum Submit"
  tidak lagi menyeret lokasi yang memang belum mulai.
- `PetaMarker.isActive` ditambahkan sebagai sumber tone tersebut.

### `regionOf` dipindah ke `src/lib/region.ts` + tahan variasi penulisan

`Location.province` adalah teks bebas (ketik manual / ikut kolom Excel impor),
tetapi dulu dicocokkan PERSIS ke tabel nama provinsi dan sisanya jatuh ke
"Lainnya" yang tidak pernah ditampilkan — data bisa lenyap tanpa jejak.
Sekarang: normalisasi (huruf kecil, buang tanda baca & kata "Provinsi"/"Prov."/
"Daerah Istimewa") + alias singkatan (NTB, NTT, DIY, JATIM, …) + kata kunci
pulau; dan ember "Lainnya" **ikut ditampilkan bila terisi** sehingga Σ kartu =
jumlah lokasi.

### Verifikasi

typecheck ✓ · lint ✓ · unit **416** (kkp-sheet +5 termasuk fuzz deterministik
300 jadwal acak — Σ weeklyShown == bobotShown & Σ bobotShown == 100 di semua
kasus; region +4; xlsx-kurva-bobot +2 yang membaca file .xlsx hasil dan
membuktikan Σ sel minggu tertulis == cache rumus) · build ✓.

Batas galat yang melekat (bukan bug): sel minggu bisa menyimpang sampai ~0,011
dari nilai penuh presisi **bila kategori hanya aktif satu minggu** — sel tunggal
itu memikul seluruh pembulatan bobot ke 2 desimal. Konsekuensi metode sisa
terbesar: sebuah bobot sesekali dibulatkan ke bawah (mis. 0,34606 → 0,34, bukan
0,35) supaya kolom tetap menjumlah tepat 100,00. Kolom yang menjumlah dinilai
lebih penting daripada pembulatan terdekat per sel.

---

## 158 · 2026-07-27 · Baris rencana kurva-S kembali RUMUS (membatalkan penguncian B3 di Excel)

Keputusan user setelah menemukan baris "Rencana Prestasi %" dan "Kumulatif
Rencana Prestasi %" di Excel berisi angka statik: **kembalikan persis seperti
sebelum commit `60673a4`**.

- `Rencana Prestasi %` = `SUM(kolom minggu itu, baris kategori pertama:terakhir)`
- `Kumulatif Rencana` = `{kumulatif minggu lalu} + {rencana minggu ini}`

Penguncian di B3 (DECISIONS 155) dilakukan agar baris rencana memakai kurva
baseline RESMI (`scurve.planPct`) yang juga dipakai PDF halaman-2 dan dashboard.
Efek sampingnya — rumus mati, rencana tidak lagi tertelusur ke jadwal
pembentuknya — tidak diminta user dan tidak dilaporkan saat itu.

**Konsekuensi yang diterima user**: bila matriks jadwal kategori berbeda dari
kurva baseline resmi (hanya terjadi bila titik kurva pernah diedit manual tanpa
menyentuh `scheduleItems`), angka rencana di Excel bisa berbeda tipis dari PDF
halaman-2 dan dashboard. Layar/PDF tetap memakai kurva resmi.

Nilai cache rumus diambil dari **sel kategori yang benar-benar ditulis**
(bukan kurva resmi) supaya angka tersimpan tidak pernah bertentangan dengan
hasil hitung Excel; cache baris helper grafik mengikuti sel yang dirujuknya.
Uji penjaga: `tests/unit/xlsx-kurva-bobot.test.ts` menuntut kedua baris berupa
rumus + cache == Σ sel kategori kolomnya.

Verifikasi: typecheck ✓ · lint ✓ · unit **417** ✓ · build ✓.

---

## 159 · 2026-07-27 · Penyesuaian halus kurva-S ikut menyetel jadwal kategori

Pertanyaan user: "kalau aku edit di menu yang sudah kamu sediakan, bukankah
semuanya menyesuaikan?" Penelusuran seluruh jalur tulis baseline menunjukkan
jawabannya **ya untuk semua jalur kecuali satu**:

| Jalur | Titik kurva | Jadwal kategori | Sinkron |
|---|---|---|---|
| Editor jadwal per kategori (`saveCategorySchedule`) | dihitung dari jadwal | disimpan | ya |
| Re-import Time Schedule Excel (`saveScheduleMatrix`) | dihitung dari matriks | disimpan | ya |
| Regenerate otomatis / impor RAB | satu sumber | satu sumber | ya |
| Pulihkan baseline lama (`restoreBaseline`) | disalin | disalin | ya (mewarisi versi asal) |
| **Penyesuaian halus %-mingguan (`updateBaselinePoints`)** | diganti | **disalin apa adanya** | **TIDAK** |

Akibatnya, sesudah penyesuaian halus: Excel (baris rencananya rumus Σ kolom
kategori, DECISIONS 158) menampilkan kurva LAMA — termasuk garis rencana di
grafiknya — sementara PDF halaman-2, halaman-1 layar, dan dashboard memakai
kurva hasil penyesuaian.

### Keputusan user: jadwal ikut menyesuaikan (opsi 1)

`rescheduleToCurve` (`scurve/generate.ts`, murni) menyetel ulang matriks jadwal
mengikuti kurva baru sambil menjaga **dua marginal sekaligus**:

- Σ kolom (semua kategori pada satu minggu) = increment kurva baru;
- Σ baris (satu kategori sepanjang kontrak) = bobot kategori, TIDAK berubah.

Menskala tiap kolom dengan `increment baru / increment lama` hanya memenuhi
syarat pertama dan **merusak** yang kedua — bobot kategori tidak lagi sama
dengan porsi nilainya di RAB, padahal kolom Bobot (%) blanko KKP adalah angka
RAB. Karena itu metodenya **pemetaan waktu**: tiap kategori dibaca ulang pada
titik kemajuan global yang sama (interpolasi linear atas kumulatifnya sendiri).
Kurva digeser/direntang, seluruh jadwal ikut bergeser dengan bentuk yang sama.
Sebagai bonus, jumlah minggu boleh berubah — jadwal ikut diregangkan, dulu
malah dibuang sehingga halaman-1 jatuh ke jadwal otomatis.

UI diberi tahu: subtitle kartu + teks bantuan editor menyebut jadwal per
pekerjaan ikut menyesuaikan dan bobot tetap sesuai RAB.

Verifikasi: typecheck ✓ · lint ✓ · unit **422** (rescheduleToCurve +5: idempotent
saat kurva tak berubah, dilambatkan, dipercepat, jumlah minggu berubah, matriks
nol; tiap kasus memeriksa kedua marginal) · build ✓.

---

## 160 · 2026-07-27 · Sheet Laporan: identitas tidak terpotong + angka terhitung jadi rumus

Temuan user pada file .xlsx nyata:

1. **Nilai identitas terpotong.** Blok identitas menulis nilai di sel gabungan
   C:H. Sel gabungan tidak melimpah ke kolom tetangga dan tidak ikut auto-tinggi,
   jadi nama paket KKP (>80 karakter) terpotong di tengah kalimat. Sekarang
   digabung C..kolom terakhir tabel (Q, ±147 karakter); bila masih lebih panjang,
   teks dibungkus dan tinggi baris ditambah sesuai jumlah barisnya.
2. **Rencana/Realisasi/Deviasi s/d periode** di kepala dokumen ditulis sebagai
   angka. Kini rumus: Rencana = `=O{JUMLAH}` (JUMLAH kolom Bobot Rencana),
   Realisasi = `=N{JUMLAH}` (JUMLAH kolom Bobot S/d — `actualPct` memang
   didefinisikan Σ bobot s/d di periodic-report.ts), Deviasi = `=Realisasi −
   Rencana` (formula kanonik progress.ts).
3. **Kolom "Sisa Pekerjaan"** (Prestasi & Volume) ditulis sebagai angka padahal
   jelas turunan. Kini rumus persis formula kanonik: `MAX(0,100−M{baris})` dan
   `MAX(0,C{baris}−L{baris})`.
4. **Bobot di baris judul kategori** ditulis dua kali (di baris judul dan di
   baris Subtotal). Baris judul kini mengikuti sel subtotalnya (`=E{subtotal}`) —
   satu angka, satu sumber.

Catatan teknis: exceljs tidak menulis nilai cache ketika hasilnya 0, jadi sel
rumus bernilai nol terbaca tanpa `result` (pembaca non-Excel memperlakukannya 0).
Uji penjaga `tests/unit/xlsx-laporan-rumus.test.ts` memperhitungkan itu dan
memeriksa: rentang merge identitas, teks identitas utuh, rumus + cache kolom
sisa, tautan tiga angka ringkasan ke baris JUMLAH, dan bobot judul kategori.

Verifikasi: typecheck ✓ · lint ✓ · unit **426** ✓ · build ✓.

---

## 161 · 2026-07-27 · PDF laporan mingguan/bulanan ke Drive = blanko resmi KKP

Temuan user: PDF yang disetor ke Google Drive "membuat format sendiri".
Penelusuran ketiga jalur unggah:

| Unggahan Drive | Renderer | Format |
|---|---|---|
| Laporan harian | `pdf/harian-kkp.ts` | blanko resmi KKP (DECISIONS 145) — benar |
| Laporan mingguan | `pdf/periodik.ts` | "ringkas profesional" (DECISIONS 126) — SALAH |
| Laporan bulanan | `pdf/periodik.ts` | idem — SALAH |

PDF ringkas itu dibuat untuk kiriman WhatsApp ke atasan, bukan untuk arsip KKP.
Yang resmi ada di halaman cetak `/cetak/periodik` (`ScurveKkpSheet` +
`KkpPeriodReport`) — acuan yang juga dipakai sheet Excel.

### `src/lib/pdf/periodik-kkp.ts` (baru)

Cermin halaman cetak, pola sama dengan `harian-kkp.ts` (grid blanko `pdf/grid.ts`,
A4 lanskap):

- **Halaman 1 — KURVA S**: identitas, matriks bobot kategori × minggu (header
  kelompok bulan + M1..MN), lima baris prestasi, garis kurva rencana (biru) &
  realisasi (hijau) digambar di atas blok baris kategori, batang skala
  KETERANGAN 0–100% kotak-kotak, blok tanda tangan 3 kolom.
- **Halaman 2+ — BLANKO RINCIAN**: kop, identitas, tabel 17 kolom dengan header
  3 baris berkelompok (No · Uraian · Volume Kontrak · Satuan · Bobot · Realisasi
  Pekerjaan {Lalu/Ini/S-d × Volume-Prestasi-Bobot} · Bobot Rencana · Sisa
  Pekerjaan), subtotal kategori, JUMLAH, ringkasan bobot, tenaga/material/alat,
  kendala, tanda tangan.

Angka diambil dari `getPeriodReport` + `buildKurvaSheet` — sumber yang SAMA
dengan layar, halaman cetak, dan Excel; termasuk `bobotShown`/`weeklyShown`
(DECISIONS 157) sehingga kolom bobot di PDF menjumlah sama dengan di Excel.
Format angka Indonesia (koma desimal) sebagaimana dokumen resmi.

`gdrive/actions.ts` untuk mingguan/bulanan kini memanggil `renderPeriodikKkpPdf`.
**Belum diubah** (menunggu keputusan user): tombol unduh PDF di layar
(`/api/laporan/periodik/...`) dan kiriman WhatsApp masih memakai PDF ringkas.

Verifikasi: typecheck ✓ · lint ✓ · unit **428** (+2 penjaga render mingguan &
bulanan) · build ✓ · PDF nyata dirender ke PNG dan diperiksa halaman per halaman
(3 halaman: kurva-S, rincian, sumber daya+kendala+TTD).

---

## 162 · 2026-07-27 · Satu format dokumen: unduh layar & kiriman WhatsApp ikut blanko KKP

Keputusan user atas pertanyaan di DECISIONS 161: **blanko** — bukan hanya untuk
unggahan Drive. Jadi tidak ada lagi dua format PDF untuk dokumen yang sama.

| Jalur | Sebelum | Sekarang |
|---|---|---|
| Drive — harian | `harian-kkp` (blanko) | tetap |
| Drive — mingguan/bulanan | ringkas | `periodik-kkp` (blanko, DECISIONS 161) |
| Unduh layar — harian | ringkas | `harian-kkp` |
| Unduh layar — mingguan/bulanan | ringkas | `periodik-kkp` |
| Kirim WhatsApp — harian | ringkas | `harian-kkp` |
| Kirim WhatsApp — mingguan/bulanan | ringkas | `periodik-kkp` |

Konsekuensi yang disadari: blanko A4 **lanskap** (17 kolom pada rincian) lebih
berat dibaca di layar HP daripada PDF ringkas yang dulu dipakai untuk WhatsApp
(DECISIONS 126). User memilih keseragaman dokumen resmi di atas kenyamanan baca
di HP.

### Kode mati dihapus

`src/lib/pdf/harian.ts`, `src/lib/pdf/periodik.ts`, dan `src/lib/pdf/table.ts`
(primitif tabel yang hanya dipakai keduanya) tidak lagi punya pemanggil dan
dihapus — membiarkannya justru mengundang pemakaian ulang yang menghidupkan lagi
"dua format untuk satu dokumen". Primitif blanko `pdf/grid.ts` dan helper
`pdf/document.ts` tetap (dipakai `harian-kkp`, `periodik-kkp`, `kegiatan`).

Verifikasi: typecheck ✓ · lint ✓ · unit **428** ✓ · build ✓.

---

## 163 · 2026-07-28 · Nama hari ganda diperbaiki di sumber + mesin rencana harian

### Nama hari disebut dua kali (temuan user)

Blanko harian menulis "Hari: Minggu" lalu "Tanggal: **Minggu**, 26 Juli 2026",
dan caption WhatsApp bahkan "**Minggu, Minggu**, 26 Juli 2026". Sebabnya
`tanggalFull` memakai `dateStyle: "full"` yang SUDAH memuat nama hari, lalu di
hilir digabung lagi dengan `hari`. Diperbaiki di sumber (`daily-report/queries.ts`
→ `dateStyle: "long"`), sehingga empat tempat ikut benar sekaligus: blanko layar,
PDF harian, dua caption WhatsApp, dan Excel harian. Tidak ada penambal per-tempat.

### Rencana mingguan → rencana harian (`lib/plan/rencana-harian.ts`)

Blanko menuntut kolom "Rencana Pekerjaan" per HARI, sedangkan rencana disimpan
per MINGGU (`WeeklyPlan`). Keputusan user: pecah jadi harian **berdasarkan alur
dan metode pekerjaan**, bukan mengulang target minggu di tiap hari.

Memakai mesin yang sudah ada, bukan aturan baru:

- **Hari mana** — `placeItems` (sequencing) menempatkan tiap item pada jendela
  tahapnya menurut tipe unit + metode kerja (persiapan → tanah → struktur →
  arsitektur → MEP → finishing, dengan presedensi antar tahap); jendela fraksi
  itu dipetakan ke hari ke-berapa dalam minggu rencana.
- **Berapa banyak** — `categoryWeeklyIncrements` menyebar volume dalam jendela
  itu memakai kurva-S (lonceng), sama seperti penyebaran bobot di kurva-S.
- **Σ harian = target mingguan PERSIS** — `allocateRounded` (3 desimal, presisi
  volume).

`allocateRounded` diangkat dari `scurve/kkp-sheet.ts` ke `lib/round-alloc.ts`
supaya dipakai bersama tanpa digandakan.

Verifikasi: typecheck ✓ · lint ✓ · unit **436** (+8: Σ harian = target, tidak ada
volume negatif, urutan metode kerja — galian mulai sebelum pengecatan, kumulatif
monoton berakhir di target, hari di luar rentang dijepit) · build ✓.

**Belum selesai (lanjutan permintaan user)**: susunan blanko harian mengikuti PDF
contoh (blok RENCANA | REALISASI berdampingan, kolom material DITOLAK, sel SHOP
DRAWING kosong, blok TTD Inspector/Pelaksana) dan logo pemilik pekerjaan yang
bisa diunggah di menu Sistem.

---

## 164 · 2026-07-28 · Eksekusi audit Codex: tenancy P0 ditutup di jalur aplikasi

Audit independen kedua (Codex, `docs/AUDIT_MENYELURUH_2026-07-28.md`, 17 temuan)
diperiksa seluruhnya ke kode. Tidak ada temuan yang terbukti salah; dua diterima
sebagian dengan koreksi fakta, satu dipersempit ruang lingkupnya dengan bukti.

### Diperbaiki

- **AUTH-01** — `hasLocationAccess()` SELALU membuktikan `package.orgId =
  user.orgId` sebelum role/assignment. Jalur DAFTAR sudah aman sejak DECISIONS
  155 (B11) lewat `locationScopeWhere`; yang bocor adalah pemeriksaan objek
  TUNGGAL — penjaga terakhir 34 pemanggil.
- **AUTH-02** — 23 lookup di `package/actions.ts` (paket, vendor, kontrak,
  lokasi) ber-scope organisasi aktor. Uji duplikat `contractNumber` sengaja
  tetap global: itu keunikan, bukan jalur akses.
- **AUTH-03** — `requireSameOrgUser()` pada `setUserActive`,
  `resetUserPassword`, `setAssignments`; `setAssignments` juga memvalidasi
  seluruh lokasi tujuan; halaman `master/pengguna` difilter organisasi.
- **AUTH-05** — tiga route PDF menegakkan `report.export`. Definisi produk yang
  diambil: **mengunduh PDF = ekspor**, karena berkasnya keluar dari aplikasi
  (Drive, WhatsApp, dokumen resmi).
- **CALC-02** — `pg_advisory_xact_lock` per lokasi sebelum guard volume di
  transisi `→ dikirim`. Ini menambal lubang di perbaikan B1 sendiri: validasi
  di dalam transaksi menutup kasus berurutan, bukan kasus paralel.
- **CALC-03** — sentinel `grandTotal = 1` dibuang; pembagi nol sudah ditangani
  `bobotPct()`. Fallback Σ item untuk RAB tanpa kategori dipertahankan.
- **SEC-01** — `/api/health` tidak lagi mengembalikan pesan error database ke
  publik; detail ke log server.

### Menunggu keputusan user

CALC-01 (arti angka progress blanko harian: as-of tanggal laporan vs saat
finalisasi), kontrak tenancy (single vs multi-organization), CI-01 (pemicu
push-ke-dev yang pernah ditolak di DECISIONS 153 M10), dan kebijakan proteksi
akun admin.

### Utang yang diakui

Perbaikan otorisasi ini **belum ditutup test** — verifikasinya pembacaan kode +
typecheck + lint + build. Persis kelemahan yang ditunjuk TEST-01. Prioritas
berikutnya: fixture dua organisasi + matriks negatif, lalu race test submit
paralel di PostgreSQL.

Verifikasi: typecheck ✓ · lint ✓ · unit **436** ✓ · build ✓.

---

## 165 · 2026-07-28 · Model deployment single-tenant + snapshot as-of + proteksi akun

### Keputusan tenancy (jawaban Fase 0 audit Codex)

**Satu instalasi = satu organisasi = satu database.** Tiap klien (Pemkab
Lamongan, KKP, Gibaku, Pemkab Banyuwangi, …) mendapat service Railway sendiri
dengan database sendiri. TIDAK ada dua organisasi hidup dalam satu database.

Konsekuensi terhadap temuan audit:

- **AUTH-04** (orgId pada AiRun/AiArtifact) — tidak berlaku sebagai batas tenant.
- **DATA-01 bagian tenant** (composite FK ber-orgId) — tidak berlaku.
  Bagian invariant lokal (uang/volume non-negatif, retensi ≤ termin, rentang
  tanggal, lat/lng, foto XOR parent) TETAP utang.
- **DATA-02** — "global" dan "tenant-local" berimpit; tidak ada pekerjaan orgId.
- Scoping `orgId` yang dipasang di DECISIONS 164 **dipertahankan** sebagai
  defense-in-depth: no-op pada model ini, penyelamat bila asumsinya jebol.

**Syarat mutlak model ini:** jangan pernah mengarahkan dua klien ke database yang
sama. Bila kelak berubah, AUTH-04 dan DATA-01/02 hidup kembali sebagai P0.

### CALC-01 — snapshot laporan harian as-of tanggal laporan

Keputusan user: **as-of tanggal laporan**. Laporan harian adalah potret hari itu;
finalisasi terlambat tidak boleh mengubah isinya.

`getLocationsProgress(ids, { asOf })`:

- realisasi hanya dari laporan counted `report_date <= asOf`;
- revisi RAB & baseline yang EFEKTIF pada tanggal itu (`createdAt <= asOf` dan
  belum digantikan), bukan yang aktif sekarang;
- minggu rencana dihitung terhadap `asOf`, bukan jam dinding.

`finalSnapshot` memanggil dengan `asOf: report.reportDate`. Tanpa `asOf`
perilaku lama dipertahankan — dashboard & halaman progress tetap posisi terkini.

### Proteksi akun (permintaan user)

- `outranks()` di `authz.ts`: admin tidak bisa mereset password atau
  menonaktifkan akun SETINGKAT atau lebih tinggi (akun sendiri dikecualikan untuk
  ganti password sendiri).
- **Admin aktif terakhir** tidak boleh dinonaktifkan — mencegah organisasi
  terkunci dari sistemnya sendiri dengan pemulihan lewat SQL produksi.

### CI-01

Keputusan user: **jalankan seperti sekarang** (tanpa pemicu push-ke-dev).
Saran yang belum dikerjakan karena butuh setelan GitHub, bukan kode: nyalakan
branch protection pada `main` (wajib PR + seluruh check hijau).

Verifikasi: typecheck ✓ · lint ✓ · unit **443** (+7 proteksi akun) · build ✓.

---

## 166 · 2026-07-28 · Identitas pemilik pekerjaan (nama + logo) pindah ke menu Sistem

Kop blanko harian dulu HARDCODE "Pembangunan Kampung Nelayan Merah Putih (KNMP)
· Kementerian Kelautan dan Perikanan". Karena MARLIN akan dipakai klien lain
(pemkab, dinas, kontraktor), identitas itu jadi setelan:

- `brand.owner_name`, `brand.owner_subtitle`, `brand.owner_logo_key` di
  `AppSetting` (pola sama dengan branding aplikasi, efektif-bertanggal).
- Form di menu **Sistem → Branding**: nama, keterangan/nama program, dan unggah
  logo (PNG/JPG/WebP, maks 2 MB). Logo dikecilkan ke ≤512px dan dinormalisasi ke
  WebP lewat sharp, disimpan di R2 — pola sama dengan logo perusahaan di master
  vendor. Pratinjau memakai presigned URL.
- Dipakai kop blanko harian di LAYAR dan di PDF. Kegagalan R2 tidak menggagalkan
  laporan — kop hanya tampil tanpa logo.
- Nilai bawaan tetap KKP/KNMP, jadi instalasi yang ada tidak berubah tampilannya
  sampai adminnya mengganti.

Verifikasi: typecheck ✓ · lint ✓ · unit **443** ✓ · build ✓.

---

## 167 · 2026-07-28 · Migrasi WAJIB idempoten + preDeploy memulihkan migrasi gagal

**Fakta pemicu, dibuktikan di PostgreSQL 16 sungguhan (bukan asumsi):** Prisma
menjalankan pernyataan di dalam satu file migrasi **satu per satu, BUKAN dalam
satu transaksi**. Ketika migrasi `20260728020000_data_integrity_checks` gagal di
Railway (`master_locations` memakai `latitude`/`longitude`, bukan
`gps_lat`/`gps_lng`), pernyataan sebelum baris yang gagal **tetap tersimpan** —
kolom `photos.location_id`, FK-nya, indeks, dan sebagian CHECK sudah terpasang.
Migrasi lalu tercatat gagal dan memblokir SELURUH deploy berikutnya (P3009),
sementara menandainya rolled-back saja tidak menolong: eksekusi ulang menabrak
objek yang terlanjur dibuat (`constraint ... already exists`).

Keputusan:

1. **Migrasi baru (28 Juli 2026 ke atas) wajib aman dijalankan ulang.** Tiap
   `ADD CONSTRAINT` didahului `DROP CONSTRAINT IF EXISTS` bernama sama; tiap
   `CREATE INDEX/TABLE` dan `ADD COLUMN` memakai `IF NOT EXISTS`. Migrasi lama
   dibiarkan — sudah terpasang di semua lingkungan, mengubahnya justru berisiko.
2. **preDeploy Railway** bukan lagi `prisma migrate deploy` telanjang, melainkan
   `node scripts/migrate-deploy.mjs`: deploy → bila kena P3009, baca nama
   migrasi yang gagal → **periksa file SQL-nya idempoten** → tandai
   `--rolled-back` → deploy ulang. Bila TIDAK idempoten, skrip BERHENTI dan
   minta penanganan manual; ia tidak pernah menebak. `--applied` sengaja tidak
   dipakai karena itu membohongi riwayat.
3. **Penjaga di CI**: `tests/unit/migrasi-idempoten.test.ts` memakai fungsi
   pendeteksi yang SAMA dengan skrip preDeploy, sehingga aturan dan
   penegakannya tidak bisa berbeda.

Verifikasi (PostgreSQL 16 lokal, kondisi Railway direproduksi persis): SQL rusak
→ P3018; deploy ulang → P3009 (tersangkut, separuh terpasang); skrip preDeploy →
pulih dan migrasi terpasang penuh; `migrate diff` → tidak ada drift; skrip
dijalankan lagi → no-op. Ditambah: `db:seed` penuh lolos, tiap CHECK diuji
menolak data mustahil, dedup foto diuji lintas lokasi.
typecheck ✓ · lint ✓ · unit **453** ✓ · build ✓.

---

## 168 · 2026-07-28 · Audit uang & status ditulis DI DALAM transaksinya

Sebelumnya `audit()` selalu dipanggil SESUDAH mutasi commit, dan kegagalannya
sengaja ditelan (`catch → console.error`). Akibatnya uang bisa berpindah atau
status berpindah TANPA jejak — persis yang ditemukan AUDIT-01.

Keputusan: dua kontrak yang berbeda dan eksplisit.

- `audit()` — tetap best-effort, untuk peristiwa non-kritis.
- `auditIn(tx, …)` — menulis di dalam transaksi pemanggil dan **tidak menelan
  error**. Mutasi dan jejaknya sehidup-semati: audit gagal ⇒ mutasi batal;
  mutasi batal ⇒ tidak ada audit yatim. IP dibaca sebelum transaksi dibuka.

Penerapan: seluruh 15 aksi keuangan lewat helper `mutasiBerjejak`, dan seluruh
transisi status laporan harian lewat `transition()` yang memang satu-satunya
pintu. Guard `res.count === 0` yang dulu `return { error }` kini `throw
GuardError` supaya transaksinya ikut batal — pesan ke user tidak berubah.

Verifikasi: `tests/integration/audit-atomik.test.ts` menyuntikkan kegagalan
audit sungguhan di tengah transaksi dan menuntut pembayarannya ikut batal.

---

## 169 · 2026-07-28 · Utang uji TEST-01 dibayar dengan PostgreSQL sungguhan

Tiga dari empat utang uji yang diakui di audit ditutup, dijalankan terhadap
PostgreSQL 16 nyata (bukan ditunda ke CI seperti rencana semula):

1. `tenancy-dua-organisasi.test.ts` — DUA organisasi lengkap di SATU database.
   Justru karena produksi single-org, scoping `orgId` tidak pernah benar-benar
   teruji tanpa fixture ini: ia "lulus" hanya karena tidak ada tetangga.
2. `laporan-harian-race-asof.test.ts` — dua submit paralel di satu lokasi
   (advisory lock CALC-02) dan golden test as-of (CALC-01).
3. `audit-atomik.test.ts` — fault injection audit (DECISIONS 168).

Temuan sampingan yang layak dicatat: perhitungan as-of memakai revisi RAB yang
EFEKTIF pada tanggal itu, jadi revisi yang dibuat belakangan tidak berlaku
surut — fixture uji harus di-back-date, dan itu memang perilaku yang benar.

Masih utang: parity output layar vs PDF vs Excel vs WhatsApp.

---

## 170 · 2026-07-28 · Foto laporan harian bisa dihapus selama laporan masih draft

Temuan user: foto laporan harian TIDAK BISA dihapus sama sekali — aksinya
memang tidak pernah dibuat (yang ada hanya di Kegiatan Lapangan). Lebih buruk,
menghapus item pekerjaan hanya MELEPAS fotonya (`reportItemId = null`) dan foto
itu lalu tidak ditampilkan di mana pun, sehingga mustahil dibersihkan baik dari
layar maupun dari bucket R2. Draft yang tidak bisa dikoreksi penuh adalah bug,
bukan desain — mandor salah pilih foto dari galeri itu kejadian wajar.

Keputusan (user, 28 Juli 2026):

- **Siapa yang boleh**: PENGUNGGAH foto itu sendiri, Site Manager, atau
  Super Admin. Ditegakkan di server (`removeReportPhotoAction`), bukan hanya
  disembunyikan di UI.
- **Kapan**: hanya saat laporan berstatus `draft` atau `perlu_koreksi`. Begitu
  dikirim, foto sudah jadi dasar verifikasi — mengubah bukti setelah itu bukan
  koreksi.
- **Foto yatim**: statusnya DITURUNKAN (`reportItemId` kosong padahal `reportId`
  terisi), BUKAN disimpan sebagai kolom flag. Flag tersimpan adalah fakta
  turunan yang bisa melenceng dari kenyataan — dilarang PROJECT.md. Karena
  fotonya masih menempel ke laporan, yang sudah terlanjur yatim langsung
  terjangkau begitu galeri menampilkannya: TIDAK perlu migrasi atau backfill.
- UI: blok "Foto tanpa pekerjaan" di editor laporan harian, plus tombol hapus
  pada galeri per item.

Urutan hapus: baris DB dulu, objek R2 belakangan — gagal menghapus objek hanya
menyisakan berkas tak terpakai, sedangkan urutan sebaliknya menyisakan foto
rusak di layar.

Verifikasi: `tests/integration/hapus-foto-harian.test.ts` (8 kasus) — pengunggah
boleh; mandor lain DITOLAK; SM & Super Admin boleh; dikirim/final ditolak;
perlu_koreksi boleh; foto yatim terbukti terjangkau dan terhapus.
typecheck ✓ · lint ✓ · unit 456 ✓ · integrasi 9 berkas/72 uji ✓ · build ✓.

---

## 171 · 2026-07-28 · Badge nama pekerjaan pada cap foto dijamin muat

Cacat di lapangan: nama pekerjaan panjang ("PEKERJAAN SONDIR TERMASUK PELAPORAN
TERMASUK MOBILISASI ALAT DAN PERSONIL") membuat pill merah melar melewati tepi
kanan foto, DAN teksnya ikut terpotong. Sebabnya berlapis:

1. `badgeW` dihitung dari estimasi lebar teks TANPA dibatasi lebar kanvas.
2. Teks di-anchor di TENGAH pill, jadi begitu pill lebih lebar dari kanvas,
   titik tengahnya keluar layar dan huruf depan ikut terbuang.
3. Estimasi lebarnya sendiri meleset. DIUKUR (render + trim tinta): faktor
   sebenarnya 0,715–0,724 per huruf kapital tebal; rumus lama memakai 0,63 —
   kurang ~13%.

Perbaikan berlapis pula:

- Lebar pill dibatasi lebar aman kanvas (`w - 2·safeX`).
- `fitBadge`: kecilkan font sampai batas bawah, baru potong dengan elipsis.
- Faktor estimasi dikoreksi ke 0,75 (marjin di atas hasil ukur).
- **`textLength` + `lengthAdjust="spacingAndGlyphs"`** sebagai jaminan KERAS:
  teks dipaksa persis selebar bagian dalam pill, jadi hasilnya tidak bergantung
  pada metrik font yang dipakai runtime. Ini yang penting — produksi memakai
  font tertanam "MB", bukan sans-serif yang dipakai saat kalibrasi.

Sekalian: label "Foto dokumentasi (maks 6)" di form kegiatan lapangan ternyata
BASI — batas kegiatan sudah 32 (`MAX_PHOTOS_PER_ACTIVITY`), angka 6 itu batas
per-unggah laporan harian. Ditulis sebagai teks mati sehingga tidak ikut berubah
saat limitnya dilonggarkan. Konstanta batas dipindah ke `lib/photo-limits.ts`
(modul MURNI, tanpa dependensi server) supaya komponen klien memakai angka yang
SAMA dengan yang ditegakkan server.

Verifikasi: `tests/unit/stamp-badge.test.ts` (5 kasus) — pill selalu di dalam
kanvas (lanskap, potret, foto sempit 640×480), teks selalu di dalam pill, nama
pendek tidak dipotong. Plus pemeriksaan visual hasil render.
typecheck ✓ · lint ✓ · unit 461 ✓ · build ✓.

## 172 · 2026-07-29 · Adendum RAB tahap (a): editor draft di aplikasi, bukan hanya Excel

Kebutuhan lapangan: adendum harga = ubah volume item, tambah item pekerjaan,
atau tambah bangunan baru. Selama ini satu-satunya jalur revisi RAB adalah
impor Excel — merepotkan untuk perubahan kecil dan tidak menegakkan aturan
adendum apa pun.

Dasar aturan (riset online, Perpres 16/2018 Pasal 54 + praktik CCO):

1. **Harga satuan item LAMA terkunci** (harga kontrak tetap). Di editor memang
   TIDAK ADA jalur mutasi harga item lama — yang bisa diubah hanya volume.
2. **Item baru** = hasil negosiasi; harga satuannya bebas diisi.
3. **Pekerjaan tambah maksimal 10% nilai kontrak awal** → jadi warning (bukan
   blocker) pada tahap (b) — MARLIN mencatat kenyataan, bukan menolaknya.

Keputusan desain (persetujuan user 29 Juli 2026):

- Semua editan terjadi pada **REVISI DRAFT** salinan penuh revisi aktif
  (lineageKey ikut disalin → realisasi nyambung otomatis saat diaktifkan lewat
  `activateRevision` yang sudah ada). Angka live tidak tersentuh sampai aktivasi.
- **Volume minimal = realisasi tercatat** (`cumulativeVolumeByLineage`).
  Pekerjaan-kurang atas item berjalan maksimal sampai volume terealisasi.
- **Hapus hanya untuk node tanpa realisasi** — bukti lapangan tidak boleh
  kehilangan induk RAB. Jejak penghapusan permanen: audit log
  (`rab.adendum_node_remove`) + item terhapus tetap terlihat di `diffRevisions`
  karena revisi lama append-only.
- **Semua agregat SELALU dihitung ulang penuh dari daun** per mutasi
  (`recomputeTotals`) — tidak pernah diedit langsung (prinsip #4 CLAUDE.md).
- Satu lokasi maksimal SATU draft pada satu waktu.
- Setiap mutasi ber-audit SEATURAN transaksinya (`auditIn`, AUDIT-01).

Implementasi: `src/lib/rab/adendum.ts` (service + diff), server actions +
halaman `/lokasi/[slug]/rab/adendum` (editor inline: edit volume per baris,
tambah item per kategori, tambah kategori/bangunan, hapus berpenjaga, panel
diff lama→baru dengan delta nilai). Aktivasi/buang draft tetap lewat riwayat
revisi di halaman RAB.

Tahap (b) berikutnya: wizard dari ContractAmendment (amendmentId link, validasi
nilai vs kontrak, warning 10%), tahap (c): halaman review sebelum aktivasi +
lampiran dokumen adendum. Ditambah fitur cetak Excel RAB aktif 3 sheet
(Resume / Sub Resume / Detail) dengan formula antar-sheet.

Verifikasi: `tests/integration/adendum-editor.test.ts` (8 kasus, Postgres asli)
— salinan draft + tolak draft kedua, volume < realisasi ditolak, harga item
lama tak tersentuh, agregat selalu dihitung ulang, tambah item/kategori, hapus
ber-realisasi ditolak + hapus berjejak audit, diff (dihapus/ditambah/diubah),
mutasi non-draft ditolak. typecheck ✓ · lint ✓ · unit 461 ✓ · integrasi 80 ✓ ·
build ✓.

## 173 · 2026-07-29 · Adendum lengkap: grid Excel-like, link CCO, review aktivasi, ekspor Excel 3 sheet

Lanjutan 172, satu putaran penuh sesuai arahan user ("langsung lanjut semua"):

1. **Editor jadi grid gaya Excel** (AG Grid via MarlinGrid + mode edit baru:
   `singleClickEdit`, Enter turun baris, simpan saat sel kehilangan fokus).
   Satu klik langsung mengetik — tanpa tombol OK per baris. Kolom lama vs baru
   berdampingan (Vol. kontrak → Vol. adendum, Jumlah kontrak → Jumlah adendum,
   Δ per baris dihitung server). Item BARU: kode/nama/satuan/harga satuan bisa
   diketik langsung di sel (`updateDraftNewItemFields` — DITOLAK untuk item
   lama, dicek terhadap lineage revisi aktif). Gagal simpan → sel dikembalikan
   ke nilai lama + banner alasan.
2. **Link CCO**: draft adendum bisa dikaitkan ke `ContractAmendment` saat
   dibuat (dropdown CCO paket; divalidasi milik paket lokasi). Peringatan
   otomatis (informasi, bukan penghalang): (a) pekerjaan tambah
   (`diffRevisions.totalTambah`) > 10% nilai RAB kontrak awal — batas Perpres
   16/2018; (b) Δ draft + PPN ≠ `valueDelta` CCO terkait.
3. **Review aktivasi di tempat**: tombol Aktifkan/Buang langsung di halaman
   adendum — konfirmasinya menyebut ringkasan (n tambah/hapus/ubah + Δ) dan
   mengingatkan bila ada peringatan nilai. Mesin aktivasi tetap yang lama
   (`activateRevision` + regenerate baseline).
4. **Dokumen CCO**: riwayat adendum di halaman Kontrak paket kini punya kolom
   Dokumen — lampirkan file per CCO tanpa pindah halaman
   (`uploadDocumentAction` sekarang meneruskan `amendmentId`/`contractId`).
5. **Ekspor Excel RAB aktif 3 sheet** (`lib/export/rab-xlsx.ts` +
   `/lokasi/[slug]/rab/export`): Resume → Sub Resume → Detail RAB, SEMUA
   TERTAUT FORMULA antar sel/sheet (pola konsep file KKP): Jumlah item =
   `ROUND(volume×harga,0)` (cermin `valueDone`), induk = penjumlahan sel anak,
   Sub Resume menunjuk baris Detail, Resume menunjuk subtotal Sub Resume,
   PPN/TOTAL/DIBULATKAN juga rumus. Nilai cache tiap sel rumus = angka DB
   (via `ppnAmount`/`withPpn` — bukan hitungan lokal baru), jadi tampilan
   identik aplikasi sebelum rekalkulasi.

Verifikasi: unit 465 ✓ (rab-xlsx 4 kasus: urutan sheet, rumus item/induk,
referensi antar-sheet, PPN/pembulatan) · integrasi 81 ✓ (adendum-editor 9,
termasuk harga item baru boleh / item lama terkunci) · typecheck ✓ · lint ✓ ·
build ✓.

## 174 · 2026-07-29 · Ekspor RAB tampilan profesional + TUNTASKAN aturan Combobox (kritik user)

Kritik user atas ekspor Excel RAB: kode kategori tampil `VI#2`/`VIII#8`
(artefak dedup lineageKey bocor ke dokumen), roman ganda/loncat dan digabung
ke teks uraian, item ber-"spasi banyak" (indentasi spasi literal). Plus:
combobox induk di form "Item baru" adendum masih `<select>` native — melanggar
aturan DECISIONS 094/115 (SEMUA dropdown filterable).

- **Ekspor RAB 3 sheet — lapisan TAMPILAN saja, angka/rumus tidak berubah**
  (`lib/export/rab-xlsx.ts`):
  - Suffix dedup internal `#N` pada kode DILARANG tampil (strip `/#\d+$/`).
  - Kategori dinomori ULANG berurutan (I, II, III, … urutan dokumen) dan
    dipakai konsisten di ketiga sheet; di Resume roman masuk kolom **No**,
    uraian = nama saja. (File sumber HPS nyata memuat roman ganda/loncat
    antar bangunan — penomoran dokumen ekspor tak boleh mewarisinya.)
  - Indentasi hierarki pakai `alignment.indent` natif Excel (bukan spasi
    literal); nama dinormalisasi dari spasi ganda; baris kategori diberi fill;
    uraian wrapText. Unit test baru menjaga: tak ada `#N` di body sheet.
- **Adendum**: form "Item baru" → `Combobox` searchable untuk pilih induk
  (ratusan opsi) + field berlabel (`Label`/`Input`), bukan input polos; form
  kategori baru sama; dropdown CCO di form buat draft → `Combobox`; kolom Kode
  grid menyembunyikan suffix `#N` (valueFormatter, display-only).
- **Sapu bersih sisa `<select>` native app** (ditemukan 8): sistem (cakupan
  rebuild snapshot, 83 lokasi), AI run distribusi WA, AI report period, pulse
  filter readiness, chat-grup global + per-paket (kontak), kegiatan (filter
  jenis/status) — semua → `Combobox`. `<Select>` primitive di `ui/field.tsx`
  dibiarkan ada untuk print/cetak bila perlu, tapi TIDAK dipakai form app.
- Verifikasi: typecheck ✓ · lint ✓ · unit 470 ✓ (rab-xlsx 5). Integrasi tidak
  jalan di kontainer ini (tanpa Postgres) — perubahan murni presentasi/UI,
  service adendum tak disentuh.

## 175 · 2026-07-29 · Impor RAB: kolom NEGOSIASI gagal terdeteksi pada 2 varian header (nilai kontrak terbaca = pagu HPS)

User melaporkan parser "selalu ambil harga HPS atau penawaran, bukan
negosiasi". Benar, dan dampaknya uang: nilai kontrak terimpor sebesar PAGU.

**Diagnosis (diukur pada 3 file Lampiran Negosiasi nyata + 1 file HPS murni).**
`detectColumns` lama hanya mengenali dua bentuk header. Korpus nyata memuat
setidaknya lima; dua di antaranya lolos ke fallback posisi klasik G/H = HPS:

- **(d) Kedungrejo** — baris grup `HPS | PENAWARAN | NEGOSIASI` ada, tetapi
  sub-headernya `HPS | TOTAL HPS | HARGA PENAWARAN | TOTAL PENAWARAN |
  HARGA NEGOSIASI | TOTAL NEGOSIASI`. Deteksi lama menuntut kata harfiah
  "HARGA SATUAN" di baris bawah untuk mengaktifkan mode 2-baris; karena tak
  ada, ia jatuh ke mode 1-baris, lalu `isPriceHeader("NEGOSIASI")` gagal
  (tak memuat "HARGA"/"NILAI") → G/H (HPS).
- **(e) Pesisir** — label blok ada di **baris 1**, header utama (VOL/SAT +
  tiga pasang `HARGA SATUAN`/`JUMLAH HARGA`) baru di baris 9. Deteksi lama
  hanya melihat header utama + 1 baris di bawahnya → mengambil pasangan
  PERTAMA (= HPS).

Selisih terukur (total kategori, baris hidden dikecualikan spt biasa):

| File | Terbaca SEBELUM (HPS) | Seharusnya (nego) | Selisih |
|---|---|---|---|
| Kedungrejo | 2.621.552.025 | 2.505.445.677 | −116.106.348 (−4,4%) |
| Pesisir | 3.893.781.159 | 3.723.269.226 | −170.511.933 (−4,4%) |
| Asemdoyong (varian (c), sudah benar) | 3.232.956.644 | 3.232.956.644 | 0 |
| HPS murni Kedungrejo Bwi (kontrol) | 4.102.114.218 | 4.102.114.218 | 0 |

**Keputusan.** Deteksi kolom tidak lagi bergantung pada frasa header tertentu:

1. Cari baris GRUP di mana pun pada/di atas header utama yang memuat ≥2 label
   blok (`HPS|PENAWAR|NEGO`) di kolom nilai (≥5). Ambang ≥2 mencegah kata
   "HPS" di judul dokumen dianggap baris grup.
2. Rentang kolom tiap blok = label blok non-kosong terdekat di kiri (merge
   left-anchored).
3. Peran kolom dari gabungan label header utama + sub-header:
   `TOTAL|JUMLAH` → kolom jumlah; `HARGA|NILAI|SATUAN` → harga satuan
   (kolom rasio TKDN/KDN/BOBOT/%/TIMPANG dikecualikan). Cek TOTAL dulu supaya
   "JUMLAH HARGA" tak salah dibaca sebagai harga satuan.
4. Prioritas nilai kontrak tetap **NEGOSIASI > PENAWARAN > HPS** (HPS = pagu,
   tak pernah jadi nilai kontrak). Tanpa baris grup → jalur lama; tanpa header
   sama sekali → posisi klasik G/H/I.
5. Sub-header dikenali dari ≥2 label bernuansa nilai — TIDAK menuntut frasa
   "HARGA SATUAN".

**Jaring pengaman + transparansi** (protokol integritas angka: jangan
mengandalkan build hijau):

- Cek-silang data: bila >30% baris berharga gagal `volume × harga satuan =
  jumlah` (min. 20 sampel), pratinjau memberi PERINGATAN kolom mungkin salah.
  Parser TIDAK diam-diam mengoreksi angka.
- `parseHpsBuffer` kini mengembalikan `priceColumn` (`source` + label
  "NEGOSIASI (kolom K/L)"), ditampilkan di pratinjau impor sebelum commit —
  supaya salah-kolom ketahuan mata, bukan setelah kontrak jalan.

**Dampak data lama.** Lokasi yang RAB-nya diimpor dari file varian (d)/(e)
sebelum perbaikan ini menyimpan harga PAGU. Perbaikan parser tidak menyentuh
data tersimpan — lokasi terdampak wajib impor ulang file negosiasinya
(jalur impor biasa; bila kontrak sudah SPMK ini menjadi adendum, DECISIONS 118).

Verifikasi: unit hps-parser 26 kasus (termasuk fixture varian (d) & (e), file
HPS murni, dan dua kasus cek-silang) · typecheck ✓ · lint ✓ · unit 471 ✓ ·
dijalankan pada 4 file Excel nyata (angka di tabel atas).

## 176 · 2026-07-29 · Cuaca laporan harian: kondisi PER JAM dari koordinat lokasi (bukan satu kategori sehari)

Usul user: cuaca di laporan harian diambil dari layanan cuaca berdasar
koordinat lokasi. Pemeriksaan format yang berjalan menemukan masalah yang
lebih besar dari sekadar "belum otomatis":

- Input: SATU radio 6 pilihan → `DailyReport.weather`, satu nilai sehari penuh.
- Blanko KKP: tabel "Kondisi Cuaca" dengan **15 kolom jam (07.00–21.00)** dan 3
  baris kategori (Cerah/Mendung/Hujan), diisi
  `d.activeWeather === cat ? "✓" : ""` — satu kategori dicentang RATA di kelima
  belas kolom. Hujan sejam sore tercetak identik dengan hujan seharian.

**Sumber data.** User mengoreksi arah pemilihan sumber: laporan harian diisi di
UJUNG hari, jadi yang dibutuhkan jam-jam yang SUDAH terjadi. BMKG publik
(prakiraan per wilayah desa, granularitas 3 jam, terbit pagi hari) tidak cocok
mengisi kolom jam lampau. Dipakai **Open-Meteo** endpoint `forecast` dengan
`past_days` — per jam, per koordinat, analisis (observasi + model). Arsip ERA5
tidak dipakai karena tertinggal beberapa hari sehingga tak berguna untuk hari
berjalan. Base URL bisa ditimpa `WEATHER_API_URL` (mirror/langganan bila
lisensi komersial menuntutnya — BELUM diverifikasi, lihat "sisa risiko").

**Keputusan.**

1. `DailyReport.weatherHourly` (Json) menyimpan kondisi per jam 07–21;
   `weather` (satu nilai) tetap ada sebagai ringkasan untuk ekspor/AI/WhatsApp.
2. `WeatherObservation` = cache per (lokasi, tanggal), 83 lokasi × 1 panggilan
   per hari. Jam hujan & curah total **diturunkan**, tidak disimpan (aturan
   agregat derived).
3. **Pengamatan lapangan menang.** `weatherSource` = `manual` begitu orang
   lapangan memilih cuaca; pengambilan otomatis menolak menimpanya kecuali
   tombol ditekan sadar (`overwriteManual`). Memilih manual yang TIDAK sepadan
   dengan deret otomatis membuang deret itu — blanko tak boleh bercerita dua
   versi.
4. `angin_kencang` dan `banjir` TIDAK PERNAH dihasilkan otomatis — kejadian
   lokal yang hanya sah dari pengamatan.
5. Pengambilan dipicu TOMBOL, bukan diam-diam saat halaman dibuka: laporan
   lapangan tidak boleh menunggu jaringan, dan asal angka harus terlihat.
   Form menampilkan pita 07–21 supaya bisa dibandingkan dengan kenyataan.
6. Laporan `disetujui`/`final` tidak bisa diubah cuacanya; snapshot final ikut
   membekukan deret per jam.
7. Cetak (React + PDF) mencentang per jam bila ada datanya; tanpa data jatuh ke
   perilaku lama (satu kategori) — bukan regresi bagi laporan lama.

**Perubahan penjaga deploy.** `alasanTidakIdempoten` (DECISIONS 167) menolak
SEMUA `CREATE TYPE`. PostgreSQL memang tak punya `CREATE TYPE IF NOT EXISTS`,
tapi blok `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_type …) $$` benar-benar aman
diulang. Detektor diajari bentuk itu; `CREATE TYPE` telanjang dan blok DO tanpa
penjaga pg_type tetap ditolak (3 unit test baru). Migrasi diuji dijalankan DUA
KALI di PostgreSQL 16 sungguhan — sukses keduanya.

**Sisa risiko (belum terverifikasi, wajib dicek saat deploy).**

- Panggilan nyata ke Open-Meteo TIDAK bisa diuji dari kontainer kerja (proxy
  memblokir host luar, 403). Yang teruji adalah aturan & pemetaannya; penyedia
  di-mock di test integrasi. Verifikasi panggilan sungguhan dilakukan di
  Railway.
- Lisensi Open-Meteo untuk pemakaian komersial belum dipastikan.
- Berapa dari 83 lokasi yang koordinatnya kosong belum dihitung; lokasi tanpa
  koordinat ditolak dengan pesan yang menyuruh mengisi koordinat dulu.

Verifikasi: unit 489 ✓ (14 kasus cuaca + 3 kasus penjaga migrasi) · integrasi
88 ✓ di PostgreSQL 16 lokal (7 kasus cuaca: cache, manual menang, laporan
terkunci, lokasi tanpa koordinat) · typecheck ✓ · lint ✓ · build ✓.

## 177 · 2026-07-29 · Pemilih cuaca MANUAL dimatikan (bisa dihidupkan lagi) + penegasan: cuaca mengikuti TANGGAL LAPORAN

Keputusan user setelah cuaca otomatis per jam berjalan: enam radio cuaca di
form pelengkap KKP tidak lagi dibutuhkan — hilangkan dulu, tapi tetap bisa
dipakai lagi bila suatu saat perlu.

- `SHOW_MANUAL_WEATHER_PICKER = false` di `daily-report/constants.ts`. Jalur
  backend (enum, action, service, snapshot) SENGAJA utuh: ubah satu boolean
  itu ke `true` dan pemilih manual muncul lagi tanpa perubahan lain.
- **Bug yang dicegah sekalian**: kalau form tidak lagi mengirim field
  `weather`, penanganan lama (`formData.get("weather") || null`) membacanya
  sebagai "kosongkan" sehingga cuaca otomatis TERHAPUS setiap kali pelengkap
  KKP disimpan. `EnrichmentInput.weather` kini membedakan `undefined` (tidak
  dikirim → jangan sentuh kolom cuaca) dari `null` (dikosongkan sengaja).
- Konsekuensi yang diterima: selama pemilih mati, `angin_kencang` dan `banjir`
  tidak punya jalur input (keduanya memang tidak pernah dihasilkan otomatis);
  kejadian seperti itu dicatat lewat kendala/catatan laporan.

**Penegasan tanggal (pertanyaan user).** Pengambilan memakai `report.reportDate`,
BUKAN hari ini: `applyWeatherToReport` mengirim `jakartaDateKey(report.reportDate)`
dan `open-meteo.ts` menghitung `past_days` dari selisih tanggal itu terhadap
hari ini, lalu menyaring jam yang cocok dengan tanggal tersebut. Laporan yang
diisi mundur (mis. lupa 3 hari) tetap mendapat kondisi tanggalnya. Batas 60 hari
ke belakang; tanggal masa depan dan di luar batas ditolak tanpa menembak
penyedia. Perilaku ini sekarang dikunci `tests/unit/weather-open-meteo.test.ts`
(6 kasus, `fetch` di-stub). Teks bantuan di form yang sebelumnya berbunyi
"jam-jam yang sudah lewat hari ini" — menyesatkan — diganti menjadi mengikuti
TANGGAL laporan.

Verifikasi: unit 495 ✓ · integrasi 90 ✓ di PostgreSQL 16 lokal (2 kasus baru:
simpan pelengkap tanpa field cuaca tidak menghapus hasil otomatis; `null`
eksplisit tetap mengosongkan) · typecheck ✓ · lint ✓.

## 178 · 2026-07-29 · "Rapikan dengan AI" untuk teks bebas kegiatan lapangan (usulan, bukan penulisan otomatis)

Permintaan user: teks bebas di kegiatan lapangan dibantu AI supaya laporan
sistem terbaca formal dan layak dibaca.

**Bentuknya: USULAN dua langkah, bukan penulisan otomatis.** Tombol "Rapikan
dengan AI" di bawah tiap textarea (catatan, kendala, tindak lanjut — form buat
dan form edit) memanggil model, lalu menampilkan hasilnya sebagai usulan
berdampingan dengan teks asli. Menekan "Pakai" hanya mengganti isi kotak;
penyimpanan tetap lewat tombol simpan form. Tidak ada tulisan lapangan yang
berubah tanpa persetujuan orang yang menulisnya, dan tidak ada teks yang
dikirim ke model tanpa tombol ditekan.

**Penjaga anti-karang (inti fitur, `field-activity/rewrite.ts`).** Teks ini ikut
tercetak ke laporan resmi, jadi hasil model TIDAK dipercaya begitu saja.
`verifyRewrite` menolak usulan secara deterministik bila:

- memuat **angka yang tidak ada** di teks asli (penyelundupan fakta);
- **membuang angka** yang ada di teks asli (perapian tidak boleh menghapus data);
- **melar** melewati 2,2× panjang asli (mengarang paragraf, bukan merapikan);
- berupa pengantar model ("Berikut versi rapinya…") atau kosong.

Usulan yang gagal penjaga DIBUANG dengan pesan alasannya — bukan ditampilkan
dengan catatan kecil. Perbandingan angka mengabaikan pemisah ribuan/desimal
supaya perubahan format ("1.500" → "1500") tidak dianggap fakta baru.

System prompt melarang eksplisit: menambah informasi, mengubah angka/tanggal/
nama, memperhalus kabar buruk ("Kendala tetap ditulis sebagai kendala"), dan
membalas dengan pengantar. `cleanRewrite` membuang pembungkus kutip, blok kode,
dan penanda markdown (blanko KKP dicetak polos), tetapi mempertahankan
penomoran daftar karena itu isi.

**Batas & jalur aman.** Guard AI Hub (kill-switch + kuota per user/org,
DECISIONS 133) dipakai ulang supaya fitur ini bukan pintu belakang yang
melewati batas pemakaian AI. Teks < 12 karakter atau > 2000 karakter ditolak
sebelum guard & provider dipanggil. AI belum dikonfigurasi → pesan yang
menunjuk halaman Sistem, provider tidak dipanggil. Otorisasi
`field_activity.manage` + `requireLocationAccess`; tiap panggilan diaudit
(`field_activity.rapikan_teks`, mencatat jumlah karakter sebelum/sesudah dan
model — bukan isi teksnya).

Verifikasi: unit 517 ✓ — 15 kasus penjaga/pembersih/prompt + 7 kasus
perangkaian layanan (provider & guard di-mock: usulan bersih, penyelundupan
angka, AI belum diatur, teks pendek, kuota ditolak, hasil identik, provider
gagal) · typecheck ✓ · lint ✓ · build ✓.

## 179 · 2026-07-29 · Perapian teks kegiatan dipindah ke SAAT FINALISASI (menggantikan pola tombol per-field 178)

Koreksi pola dari user: "polanya user input semua, lalu saat finalkan ada opsi
rewrite atau membahasa tekniskan". Benar — tombol per-field (DECISIONS 178)
mengganggu saat mengetik dan memancing bolak-balik di tengah pekerjaan.

**Pola sekarang.** Orang lapangan mengisi seluruh kegiatan tanpa gangguan.
Tombol **Finalkan** membuka panel dengan tiga pilihan:

1. **Rapikan bahasa** — Indonesia baku yang lugas, kalimat lapangan dirapikan
   seperlunya;
2. **Bahasa teknis** — register laporan konstruksi (kalimat pasif, istilah baku
   pekerjaan sipil, hanya bila padanannya JELAS dari teks asli — tidak menebak);
3. **Finalkan apa adanya** — jalan tercepat, tanpa AI sama sekali.

Pilihan 1/2 memanggil model SEKALI untuk seluruh teks bebas (catatan, kendala,
tindak lanjut) memakai penanda bagian `[CATATAN]/[KENDALA]/[TINDAK_LANJUT]`
yang diurai deterministik — hemat kuota dan gayanya konsisten antarbagian.
Hasilnya ditampilkan **asli vs usulan berdampingan per bagian**, tiap bagian
punya centang sendiri; "Pakai & finalkan" hanya menyimpan bagian yang dicentang
lalu memfinalkan dalam satu langkah.

**Penjaga per bagian (dari 178, tetap berlaku).** Tiap bagian diperiksa sendiri:
angka baru, angka hilang, melar >2,2×, pengantar model, atau kosong → bagian itu
DIBUANG dan teks aslinya dipertahankan, dengan alasan ditampilkan. Satu bagian
bermasalah tidak menggugurkan bagian lain yang bersih. Bagian yang tidak dibalas
model juga dibiarkan apa adanya, bukan dikosongkan.

**Yang dibuang dari 178**: komponen `RewriteTextarea` dan action per-field.
Textarea kembali polos. Guard AI Hub, otorisasi `field_activity.manage` +
`requireLocationAccess`, audit tanpa isi teks (hanya gaya, model, bagian yang
dipakai/ditolak), dan batas panjang tetap seperti 178.

Verifikasi: unit 524 ✓ — 19 kasus lapisan murni (penjaga, pembersih, prompt
gabungan, pengurai penanda termasuk urutan acak & bagian absen) + 10 kasus
perangkaian layanan (satu panggilan untuk tiga bagian, penyelundupan angka pada
SATU bagian tidak menjatuhkan bagian lain, bagian pendek tidak dikirim ke model,
AI belum diatur, kuota ditolak, provider gagal, beda gaya beda instruksi) ·
typecheck ✓ · lint ✓ · build ✓.

## 180 · 2026-07-29 · Sistem → Prompt AI: satu halaman mengatur teks perintah SEMUA aksi AI

Permintaan user: perlu halaman khusus di pengaturan untuk mengatur prompt semua
aksi AI. Sebelumnya prompt tersebar sebagai konstanta di lima modul dan hanya
bisa diubah lewat deploy.

**Registri tunggal** `src/lib/ai/prompt-registry.ts` (lapisan murni) memuat 14
slot yang menutup SELURUH aksi AI yang ada:

| Kelompok | Slot |
|---|---|
| AI Hub | `hub.system` + `hub.kind.{pulse,deviasi,risiko,kualitas_data,tanya}` |
| Laporan eksekutif WA | `exec.system` + `exec.{rangkuman_kegiatan,rekap_kendala,kepatuhan_lapor}` |
| Ringkasan chat grup | `chat.summary`, `chat.overview` |
| Perapian teks kegiatan | `kegiatan.rewrite.{system,rapi,teknis}` |

Konstanta lama di `ai-hub/prompt.ts`, `exec-report/prompt.ts`,
`waha/chat-summary.ts`, `waha/summary-actions.ts`, dan `field-activity/rewrite.ts`
kini MENGAMBIL teksnya dari registri — tidak ada lagi dua sumber kebenaran.

**Penyimpanan & pembacaan** (`ai/prompts.ts`, server-only): override disimpan
sebagai AppSetting `ai.prompt.<key>` (effective-dated, pola sama dengan config
AI lain), sehingga perubahan prompt punya jejak waktu. Belum pernah ditimpa
atau isinya kosong → teks BAWAAN dipakai; sistem tidak pernah berjalan tanpa
prompt. Perubahan langsung berlaku pada aksi AI berikutnya, tanpa deploy.

**Penjaga `mustContain` — inti keputusan ini.** Tiap slot mencantumkan frasa
yang tidak boleh hilang, dan simpan DITOLAK bila frasa itu dibuang:

- `hub.system` → "BUKAN sumber angka"
- `hub.kind.deviasi` → "Jangan mengubah angka deviasi resmi"
- `hub.kind.risiko` → "Skor rule TIDAK boleh diubah"
- `hub.kind.kualitas_data` → "ditentukan rule"
- `hub.kind.tanya` → "HANYA dari data"
- `exec.system` → "JANGAN mengarang"
- `chat.summary` / `chat.overview` → "jangan mengarang…"
- `kegiatan.rewrite.system` → "JANGAN menambah informasi"
- `kegiatan.rewrite.teknis` → "JANGAN menebak"

Alasannya: prompt boleh disetel gayanya, tetapi larangan mengarang angka bukan
urusan selera. Tanpa penjaga ini, satu tempel-timpa teks baru bisa menghapus
pagar yang menjaga angka laporan resmi. Pengosongan juga ditolak — pakai
"Kembalikan ke bawaan". Batas panjang per slot ditegakkan.

**UI**: tab baru "Prompt AI" di /sistem (capability `system.manage`, sama dengan
pengaturan AI lain). Tiap slot menampilkan status Bawaan/Diubah, editor, jumlah
karakter, "Lihat teks bawaan", dan "Kembalikan ke bawaan" bila sudah ditimpa.
Frasa pengaman ditampilkan sebagai chip supaya jelas apa yang tak boleh hilang.
Audit mencatat slot, pelaku, dan jumlah karakter — BUKAN isi promptnya.

Catatan penting yang tidak berubah: AI tetap bukan sumber angka. Semua angka
laporan berasal dari calculation layer; isi prompt tidak bisa mengubah itu.

Verifikasi: unit 537 ✓ (13 kasus registri & penjaga: kunci unik, tiap bawaan
lolos validasinya sendiri, batas karakter, cakupan seluruh aksi AI, penolakan
saat frasa pengaman dibuang) · integrasi 98 ✓ di PostgreSQL 16 lokal (8 kasus:
bawaan→override→reset, override kosong = belum ditimpa, penolakan tersimpan,
penandaan Bawaan/Diubah) · typecheck ✓ · lint ✓ · build ✓.

## 181 · 2026-07-29 · Penjaga perapian teks MENANDAI, bukan memblokir (koreksi user)

Temuan user di lapangan: menekan "Rapikan bahasa" memunculkan
"Tidak ada usulan yang lolos penjaga: Hasil jauh lebih panjang dari teks asli
(mengarang, bukan merapikan)." — tiga kali, tanpa menyebut bagian mana.

Dua kesalahan saya di DECISIONS 178/179:

1. **Ambang panjang salah arah.** Batas 2,2× panjang teks asli menghukum teks
   pendek, padahal justru teks pendek yang paling wajar memanjang saat
   dibakukan: "cor kolom 12 titik" → "Dilaksanakan pengecoran kolom sebanyak
   12 titik" sudah >2,2×. Akibatnya usulan yang BENAR tertolak semua dan fitur
   praktis tidak bisa dipakai.
2. **Salah menempatkan keputusan.** Usulan tidak pernah tersimpan sendiri —
   pengguna melihat asli vs usulan berdampingan lalu mencentang. Seperti kata
   user: "karena ini tidak langsung disimpan, harusnya kamu terima saja …
   itu keputusanku menerima atau tidak."

**Keputusan.** `verifyRewrite` sekarang MENANDAI, bukan memblokir:

- Satu-satunya alasan usulan tidak ditampilkan: **hasilnya kosong** (tidak ada
  yang bisa diputuskan).
- Angka baru, angka asli yang hilang, hasil memanjang berkali-kali (>3× dan
  >400 karakter), dan balasan yang dimulai seperti pengantar model → usulan
  TETAP ditawarkan, dengan **catatan** di bawahnya ("periksa sebelum dipakai").
- Pesan kegagalan kini menyebut BAGIAN mana dan alasannya per bagian
  ("Catatan kegiatan: … · Kendala: …"), bukan mengulang satu kalimat tiga kali,
  dan menutup dengan jalan keluar: teks asli dibiarkan apa adanya.

Yang TIDAK berubah: teks tersimpan hanya yang dicentang pengguna; angka tetap
diperiksa dan dilaporkan; AI tetap bukan sumber angka.

Verifikasi: unit 538 ✓ — kasus pengganti termasuk "teks pendek yang wajar
memanjang → tanpa catatan" (kasus yang dulu memblokir) dan "angka baru → tetap
ditawarkan + bercatatan" · typecheck ✓ · lint ✓.

---

## 182 — Larangan mengarang ditegaskan di SEMUA prompt (2026-07-30)

**Permintaan user:** "tekankan ke semua prompt jangan mengarang dari sumber".

**Masalahnya nyata, bukan kosmetik.** Setelah DECISIONS 180 (registri prompt +
halaman Sistem → Prompt AI), pagar anti-mengarang hanya berdiri di slot "aturan
dasar" (`hub.system`, `exec.system`, `chat.*`, `kegiatan.rewrite.system`).
Lima slot instruksi per-jenis — `hub.kind.pulse`, `exec.rangkuman_kegiatan`,
`exec.rekap_kendala`, `exec.kepatuhan_lapor`, `kegiatan.rewrite.rapi` —
`mustContain`-nya KOSONG. Artinya admin bisa menimpanya jadi apa saja
("ringkas saja, seingatmu") dan tidak ada yang menolak. Tujuh instruksi template
Report Studio bahkan tidak lewat registri sama sekali.

**Keputusan.**

1. Frasa pagar dibakukan satu tempat: `ANTI_KARANG_FRASA = "JANGAN MENGARANG"`
   di `src/lib/ai/prompt-registry.ts`.
2. Helper `pagarSumber(sumber, bilaTidakAda)` menyusun kalimat yang seragam:
   **sumbernya disebut eksplisit** ("gunakan HANYA …"), larangan mengarang
   dirinci (angka, nama orang/instansi, lokasi, tanggal, penyebab, kesimpulan),
   dan **jalan keluar bila data tidak ada** ("tulis tidak ada di data", "belum
   lapor", "penyebab belum diketahui") — supaya model punya pilihan selain
   menebak.
3. **Ke-14 slot** registri memuat kalimat itu, dan **ke-14 slot** mewajibkannya
   di `mustContain`. Override yang membuangnya ditolak dengan menyebut frasanya.
4. Tujuh instruksi template Report Studio ikut memuat pagar yang sama, ditempel
   terpusat di `AI_REPORT_TEMPLATES` sehingga template baru tidak bisa lupa.
5. Banner halaman Sistem → Prompt AI menyebutkan syarat itu, jadi admin tahu
   sebelum menyimpan, bukan setelah ditolak.

**Yang TIDAK berubah:** angka tetap dari calculation layer; grounding filter AI
Hub tetap membuang bagian tak bersumber; penjaga hasil perapian tetap MENANDAI,
bukan memblokir (DECISIONS 181). Prompt hanya lapisan pertama — bukan satu-satunya.

Verifikasi: unit 544 ✓ (6 uji invarian baru: tiap bawaan memuat frasa & menyebut
sumber, tiap slot mewajibkannya, override tanpa frasa ditolak di SEMUA slot,
instruksi per-jenis tidak bisa dikosongkan lagi, tiap template Report Studio
memuatnya) · integration 98 ✓ (PostgreSQL 16 lokal) · typecheck ✓ · lint ✓.
Catatan: 2 uji render PDF sempat gagal saat suite penuh jalan paralel
(fontconfig) dan lulus saat dijalankan sendiri — bukan akibat perubahan ini.

## 183 — Dokumen bisa dikoreksi & dibatalkan; namanya diturunkan dari data (2026-07-30)

**Masalah (dilaporkan user).** Tiga keluhan tentang Document Center:

1. Nama dokumen di daftar **tidak bisa dibedakan**. Judul diisi manusia
   ("scan", "IMG_0231", "dokumen", "SPMK") dan satu berkas KKP sering discan
   terpisah per lembar, jadi daftar berisi baris kembar tanpa penanda.
2. Dokumen **tidak bisa dihapus atau diedit sama sekali**. Salah unggah (salah
   lokasi, salah jenis, file keliru) menetap selamanya — dan lebih buruk: tetap
   dihitung sebagai bukti milestone administrasi, sehingga panel kepatuhan
   melaporkan "selesai" atas berkas yang salah.

**Keputusan.**

1. **Nama tampilan diturunkan dari data**, bukan dari judul yang diketik
   (`src/lib/document-label.ts`, modul MURNI):
   `istilah jenis · desa/paket · tanggal · No. nomor` + `(berkas i/n)` bila ada
   beberapa berkas sejenis pada konteks yang sama. Grup = jenis + lokasi/paket +
   nomor + tanggal; urutan mengikuti waktu unggah (naik) sehingga **nomor berkas
   lama tidak bergeser** saat berkas baru masuk. Istilah pendek per jenis
   (`TYPE_SHORT`) dipisah dari label panjang yang tetap dipakai dropdown & pill.
   Judul yang diketik **tidak dibuang**: turun jadi keterangan sekunder, dan
   disembunyikan bila mubazir (mengulang jenis, sudah termuat di nama, atau
   asal-asalan seperti "scan"/"IMG_0231").
2. **Koreksi metadata** (`document.edit`): jenis, fase, nomor, tanggal,
   kadaluarsa, keterangan, judul. **Isi berkas tidak pernah ditukar diam-diam** —
   berkas keliru dibatalkan lalu diunggah ulang (jalur `supersedesId` sudah ada).
   Kombinasi fase × jenis TIDAK divalidasi di sini: jalur upload pun tidak
   memvalidasinya, jadi validasi saat koreksi justru mengunci dokumen lama pada
   kombinasi keliru yang mau dibetulkan.
3. **BATALKAN** (`document.void`, wajib alasan ≥5 karakter) — bukan hapus:
   dokumen hilang dari daftar, tidak bisa diunduh oleh pengguna biasa, tidak
   dikirim ke Drive KKP, dan **tidak lagi dihitung sebagai bukti milestone**;
   file R2 + baris DB + audit tetap utuh dan bisa **dipulihkan**.
4. **Efek kepatuhan ikut turun.** Bila tidak ada bukti aktif lain, milestone yang
   `selesai`/`berjalan` karena dokumen itu dikembalikan ke `belum_dimulai`
   (`completedAt` dikosongkan). **Pengecualian:** milestone yang sudah
   diverifikasi manusia (`verifiedById`) TIDAK diturunkan otomatis — keputusan
   orang tidak dibatalkan oleh efek samping; ia ditandai "perlu ditinjau" di
   catatan + audit. Memulihkan dokumen **tidak** menghidupkan milestone kembali;
   penilaian kepatuhan tetap keputusan manusia.
5. **HAPUS PERMANEN** (`document.delete`) — **super_admin saja**, tidak dimiliki
   program_director. Hanya atas dokumen yang **sudah dibatalkan**, ditolak bila
   masih diacu revisi RAB / bukti pengeluaran / dokumen versi penerus, dan butuh
   ketik ulang "HAPUS PERMANEN". Urutan: baris DB dulu (dalam transaksi bersama
   auditnya), lalu file R2 — bila hapus R2 gagal yang tertinggal cuma file tanpa
   acuan, bukan baris yang menunjuk file hilang.
6. Dedup sha256 hanya berlaku atas dokumen **aktif**: berkas yang pernah
   dibatalkan boleh diunggah ulang — itu justru jalur koreksi salah unggah.
7. Semua mutasi memakai `auditIn` di dalam transaksi yang sama (AUDIT-01):
   tidak ada perubahan status dokumen tanpa jejaknya.

**Jangkauan.** Daftar dokumen (`/dokumen`, lokasi, paket), panel milestone,
`gdrive/coverage`, upload ke Drive, dan penautan milestone otomatis semuanya
memfilter `status = aktif`. Halaman baru `/dokumen/[id]` memuat metadata lengkap,
asal berkas, koreksi, dan zona bahaya.

Verifikasi: unit 560 ✓ (15 kasus baru penamaan) · integration 18 kasus baru ✓
dijalankan di PostgreSQL 16 lokal (koreksi hanya kolom berubah, gerbang
capability tiap role, milestone turun/dipertahankan, tolak buang bukti
pengeluaran & sumber RAB, hapus permanen + file R2, jejak audit) · migrasi
idempoten dijalankan dua kali ✓ · typecheck ✓ · lint ✓.

## 184 — Impor dokumen dari folder Google Drive KKP (2026-07-30)

**Masalah (dilaporkan user).** Integrasi Drive baru satu arah: MARLIN bisa
MENGIRIM laporan/foto/dokumen ke folder KKP, tapi berkas yang **sudah ada** di
folder KKP (kontrak, SPMK, BA PCM, MC-0, berkas termin — sering diunggah pihak
lain) tidak bisa ditarik masuk. Akibatnya arsip MARLIN separuh kosong dan orang
harus mengunduh-lalu-mengunggah manual satu per satu.

**Keputusan.**

1. **Disalin, bukan ditautkan.** Isi berkas diunduh dan disimpan ke R2 seperti
   upload biasa; `driveFileId`, `driveWebLink`, `drivePath`, `driveModifiedAt`
   disimpan sebagai jejak asal (`source = drive_kkp`). Alasan: kalau hanya
   ditautkan, arsip MARLIN ikut hilang begitu KKP memindah/menghapus file atau
   mencabut akses akun — dan angka/laporan yang menunjuk bukti itu jadi
   menggantung. Konsekuensinya diterima: dua salinan, dan perubahan isi file di
   Drive TIDAK ikut tersalin otomatis (impor ulang = dokumen baru, karena
   `driveFileId` unik per organisasi).
2. **Dua langkah dengan mata manusia di tengah.** `previewDriveImport` membaca
   folder (maks 4 lapis, 500 berkas — batas dilaporkan ke UI bila tercapai) lalu
   mengusulkan jenis/fase/desa/tanggal per berkas; `commitDriveImport` hanya
   mengimpor yang dicentang, maks 40 berkas per tekan. Tidak ada sinkronisasi
   otomatis: klasifikasi ini tebakan, dan yang masuk arsip resmi harus disetujui.
3. **Pembacaan folder dipicu tombol**, bukan saat halaman dibuka (sejalan
   DECISIONS 176) — satu kali baca bisa puluhan panggilan jaringan.
4. **Klasifikasi murni & teruji** (`src/lib/gdrive/classify.ts`): nama berkas
   menang atas folder (folder "1. SPPBJ, SPK, SPMK, RAB, DED" memuat lima jenis),
   folder KKP jadi cadangan, keyakinan `tinggi/sedang/rendah` + alasan
   ditampilkan. Desa dicocokkan sebagai KATA UTUH (biar "Pesisir" tidak menyambar
   "Pesisirwetan"), folder didahulukan atas nama berkas, nama terpanjang menang.
   Tanggal diambil hanya dari tiga bentuk yang jelas — tanggal salah lebih
   merugikan daripada tanggal kosong karena ikut membentuk nama tampilan.
5. **Yang tidak diimpor:** folder `6. DOKUMENTASI` dan berkas foto kamera
   (`IMG_…`) — foto lapangan punya modul sendiri yang berstempel; menariknya ke
   Document Center hanya menggandakan arsip. Juga: mime tak didukung, ukuran di
   atas 25 MB, dan berkas yang `driveFileId`-nya sudah pernah diimpor.
6. **Dokumen native Google diekspor** (Docs/Slides → PDF, Sheets → XLSX) dengan
   ekstensi nama ikut disesuaikan; jenis native lain (Form, Drawing) dilewati.
7. **Commit tidak memercayai browser:** metadata tiap berkas dibaca ULANG dari
   Drive, jenis divalidasi enum, lokasi wajib milik paket itu DAN dalam scope
   penugasan pengimpor. Impor memakai `uploadDocument` yang sama, jadi seluruh
   penjaga lama tetap jalan: capability, akses lokasi, dedup sha256, penautan
   milestone otomatis, audit.
8. **Kegagalan per baris**, bukan per batch: satu berkas hilang/rusak tidak
   menjatuhkan yang lain; hasilnya dilaporkan berkas-demi-berkas.

**Belum terverifikasi.** Panggilan sungguhan ke `googleapis.com` tidak bisa
dijalankan dari kontainer kerja (proxy memblokir host luar) — yang teruji adalah
aturan impornya dengan klien Drive di-mock. Verifikasi terhadap folder KKP nyata
(termasuk kecocokan nama folder & pola penamaan berkas di lapangan) harus
dilakukan di Railway; angka "tebakan benar" pada korpus nyata belum diukur.

Verifikasi: unit 603 ✓ (43 kasus klasifikasi/pencocokan desa/tanggal) ·
integration 132 ✓ di PostgreSQL 16 lokal (16 kasus impor: pratinjau menandai
sudah-ada & dilewati, scope role, validasi lokasi lintas paket, dedup checksum,
native export, gagal per baris, audit) · typecheck ✓ · lint ✓ · build ✓.

## 185 — Scope PAKET: yang tidak ditugaskan tidak tampil; workspace dijaga di query (2026-07-30)

**Masalah (dilaporkan user).** Paket yang tidak ditugaskan muncul untuk user
selain admin. Audit menemukan kelasnya lebih luas: halaman LOKASI sudah
ter-scope rapi (`locationScopeWhere`, audit B11), tapi PAKET bocor di enam
permukaan — `/paket` (daftar + KPI), command center `/`, dropdown paket di
`/dokumen` dan `/dokumen/upload`, daftar grup di `/chat-grup`, dan yang paling
serius: `getPackageWorkspace` tidak memeriksa apa pun, sehingga siapa saja yang
tahu URL bisa membuka workspace paket mana pun — lintas penugasan, bahkan
lintas organisasi.

**Keputusan.**

1. **Aturan scope paket** (konsisten dengan pola dokumen level-paket di
   `listDocuments`): role ter-scope (RM/PM/SM/mandor) hanya melihat paket yang
   memuat MINIMAL SATU lokasi penugasannya; role lintas lokasi
   (super_admin/PD/exec_viewer) melihat semua paket ORGANISASI-nya. Penugasan
   kosong ⇒ daftar kosong, bukan semua paket.
2. **Satu helper, satu tempat**: `packageScopeWhere(user, locIds)` di
   `src/lib/auth/scope.ts`, sebaris dengan `locationScopeWhere`. Semua enam
   permukaan memakainya; tidak ada halaman yang merakit filternya sendiri.
3. **Penjaga workspace dipindah ke `getPackageWorkspace` sendiri** (bukan di
   tiap halaman): query-nya kini `findUnique({ id, ...packageScopeWhere })`.
   Paket di luar hak → null → halaman menampilkan `notFound()` — sama persis
   dengan paket yang memang tidak ada, jadi keberadaan paket pun tidak bocor.
   Seluruh tab `/paket/[id]/**` otomatis ikut terjaga.
4. `listPackages`/`getPackageStats` sekarang menerima `(user, scopedLocationIds)`
   — KPI dihitung dari scope yang sama dengan daftarnya, tidak lagi menghitung
   paket yang tak terlihat.

Verifikasi: integration 8 kasus baru ✓ di PostgreSQL 16 lokal (dua organisasi:
lintas-lokasi tidak melihat org lain; SM hanya paket lokasi penugasan; tanpa
penugasan = kosong; workspace paket asing & lintas org = null) · browser dev
server: admin melihat 9 paket, sm-01 melihat 1; URL paket asing + sub-halamannya
→ HTTP 404; dropdown /dokumen ikut menyusut · unit 603 ✓ · integration 140 ✓ ·
typecheck ✓ · lint ✓.

## 186 — WAHA: perbaikan penarikan daftar grup + verifikasi nama grup saat simpan ID (2026-07-30)

**Masalah (dilaporkan user).** Penarikan daftar grup dari WAHA gagal. Log WAHA
tidak tersedia dari lingkungan kerja, jadi jalurnya dibedah dari kode; dua akar
yang bisa DIPASTIKAN sebagai bug kita, dua lagi diperkeras:

1. **URL internal Railway dipaksa https.** `normalizeWahaBaseUrl` menambahkan
   `https://` bila skema tak ditulis. WAHA yang di-host di Railway yang sama
   lazim diisi `waha.railway.internal:3000` — private networking Railway TANPA
   TLS, jadi koneksi selalu gagal. Kini host internal (`*.railway.internal`,
   `*.internal`, localhost, IP privat) default `http://`; host publik tetap
   `https://`; skema yang ditulis eksplisit tidak pernah diubah.
2. **Error khas engine tampil mentah.** Engine NOWEB menolak `GET /groups` bila
   store dimatikan (default WAHA: mati) — pesannya bahasa Inggris terpotong,
   admin tidak tahu harus apa. `terjemahkanWahaError` (murni, diuji) mengubah
   pola dikenal jadi instruksi: store NOWEB mati → sebut
   `WAHA_NOWEB_STORE_ENABLED=true` + `WAHA_NOWEB_STORE_FULLSYNC=true` + restart
   + scan ulang + jalan keluar (Cara 2 link undangan, tanpa store); 404 sesi →
   periksa nama sesi; 401/403 → API key.
3. **Tanpa timeout.** Semua panggilan WAHA kini ber-`AbortSignal.timeout`
   (20 dtk default; 60 dtk `/groups` — akun ratusan chat lambat; 120 dtk kirim
   file base64) dengan pesan timeout yang menyebut berapa lama menunggu.
4. **Cek status sesi tidak lagi memblokir.** `listWaGroupsAction` dulu gagal
   total bila endpoint `/api/sessions/{name}` bermasalah padahal `/groups`
   sendiri jalan; kini status hanya diagnosa, `/groups` yang menentukan.
   Parser respons juga menerima bentuk peta-objek ber-key JID (store NOWEB lama).

**Verifikasi nama grup saat simpan ID (permintaan user).** Saat admin menyimpan
ID grup (manual/pilihan), sistem memanggil `GET /groups/{id}` untuk menarik NAMA
grup yang sebenarnya: nama asli WA menang atas ketikan manual dan sukses
menampilkan `terverifikasi: "<nama>"` — salah satu digit ID berarti laporan
nyasar ke grup lain, jadi nama inilah konfirmasinya. Bila ID tidak ditemukan di
akun pengirim → tetap tersimpan TAPI dengan peringatan jelas (jalur manual tidak
boleh diblokir WAHA yang mati — prinsip lama form ini); WAHA tak terjangkau →
tersimpan + peringatan "belum terverifikasi". Status verifikasi ikut ke audit.

Belum terverifikasi terhadap WAHA sungguhan (proxy kontainer memblokir host
luar) — pola respons engine diambil dari dokumentasi & bentuk yang sudah
ditangani kode lama; uji nyata harus di Railway.

Verifikasi: unit 619 ✓ (16 kasus baru: skema default URL internal/publik,
terjemahan error store/sesi/API-key, parser grup lintas engine WEBJS/NOWEB/GOWS/
peta-JID) · typecheck ✓ · lint ✓.

---

## 187 — Koreksi susunan lokasi paket berkontrak: jalur super admin, BUKAN adendum (2026-07-30)

**Kejadian nyata (laporan user).** Sebuah kontrak sudah jadi, semua nilai diisi
benar, tapi satu lokasi ketinggalan saat input: seharusnya 3 lokasi, yang
tercatat hanya 2. Ini murni salah ketik/kelewat saat entri data — isi kontrak
fisiknya tidak berubah — jadi adendum TIDAK boleh dipakai.

**Kenapa adendum salah untuk kasus ini.** Adendum berarti "kontrak berubah":
ia menuntut nomor & tanggal dokumen adendum yang di dunia nyata tidak ada,
mencatat delta nilai nol (padahal nilai kontrak memang tidak berubah), dan
mengotori jejak adendum yang dipakai laporan KKP serta rekap perubahan
kontrak. Yang terjadi bukan perubahan kesepakatan, melainkan **data kita yang
belum sama dengan kontrak**. Maka jalurnya diberi nama apa adanya: *koreksi
data*.

**Aturan yang berlaku.**

1. **Kapabilitas `location.correct` — super admin SAJA** (program_director pun
   dikecualikan, sejajar `contract.edit`). Diminta eksplisit oleh user.
2. **Hanya menambah, tidak pernah menghapus.** Menghapus lokasi dari paket
   berkontrak berarti membuang RAB, progres, laporan, dan uang yang menempel
   padanya; kalau lokasi memang kelebihan, itu urusan adendum/pembatalan
   paket, bukan tombol koreksi.
3. **Tahap yang diizinkan: `kontrak` dan `pelaksanaan`.** Sebelum kontrak,
   susunan lokasi masih bebas lewat jalur normal — aksi menolak dengan
   "pakai jalur normal". Setelah `serah_terima`/`selesai`, pekerjaan sudah
   diserahterimakan; menambah lokasi di sana bukan koreksi entri lagi.
4. **Alasan wajib, minimal 10 karakter.** Tanpa alasan, koreksi tidak bisa
   dibedakan dari manipulasi diam-diam enam bulan kemudian.
5. **Nilai kontrak TIDAK disentuh** dan tidak ada `ContractAmendment` yang
   dibuat. Nilai kontrak sudah benar sejak awal — yang kurang cuma barisnya.
6. **Jejak ganda**: `auditIn` (aksi `package.location_correct_add`, memuat
   lokasi, tahap, sumber data, alasan) + satu baris `packageStageHistory`
   dengan `fromStage === toStage` yang tampil sebagai "koreksi data" di
   riwayat paket. Tidak ada badge permanen di lokasi — pilihan user: cukup
   audit + catatan histori, lokasi hasil koreksi setara lokasi lain.
7. **Sumber data lokasi**: katalog master (menandai `assignedLocationId`,
   sehingga tidak bisa dipakai dua paket) atau isian manual. Duplikat nama/
   slug dalam paket yang sama ditolak.
8. **Peringatan lanjutan**: koreksi belum selesai sampai RAB lokasi baru
   diimpor. RAB pertama lokasi baru berlabel `hps_awal` (DECISIONS 118), jadi
   tidak mencemari jejak adendum.

Verifikasi: 11 kasus integrasi baru (`tests/integration/koreksi-lokasi.test.ts`)
— termasuk reproduksi kasus nyata 3-lokasi-terinput-2 yang memastikan
`contractValue` tetap dan `contractAmendment` tetap nol, pagar peran
(PD/RM/PM/SM ditolak), pagar tahap, lintas-org, dan duplikat · unit 619 ✓ ·
integrasi 151 ✓ ·
typecheck ✓ · lint ✓ · PERMISSION_MATRIX diregenerasi (47 capability).

---

## 188 — Katalog lokasi: pencocokan ke Location riil diperbaiki; aturan Combobox dijaga lint (2026-07-31)

Dua teguran user pada panel koreksi lokasi (187), dua-duanya benar.

**(a) `<select>` native lagi — aturan yang sudah tiga kali dilanggar.** Dropdown
katalog di form koreksi memakai `<select>`, padahal DECISIONS 094 → 115 → 174
sudah menetapkan SEMUA dropdown form pakai `Combobox` yang bisa diketik-cari.
174 bahkan lahir dari kritik yang sama. Akar masalahnya struktural: aturannya
hanya hidup di decision log sepanjang 4.900 baris, tidak ada di `CLAUDE.md`
maupun di lint. Maka:

- Dropdown katalog → `Combobox` (67 opsi, kotak cari otomatis).
- Aturan masuk `CLAUDE.md` bagian Aturan Coding.
- **Lint `no-restricted-syntax` menolak `<select>`** di seluruh `src/**/*.tsx`;
  pengecualian hanya primitive `ui/field.tsx`, `ui/combobox.tsx`, dan
  `app/cetak/`. Aturan yang tidak dijaga mesin akan dilanggar lagi.

**(b) Lokasi yang SUDAH dipakai tetap muncul di daftar pilihan.** Diukur pada
data dev: **73 dari 73** baris katalog lolos sebagai "tersedia", 6 di antaranya
terbukti sudah jadi Location riil. Bukan cuma dropdown baru — `getAvailableCatalog`
(dipakai jalur normal & bypass), halaman Katalog, pratinjau impor, dan tiga
penjaga anti-ganda di `package/actions.ts` semuanya memakai pembanding yang
sama, jadi penjaga duplikatnya pun mandul.

Akarnya kunci alami menyertakan kecamatan. Location riil lazim dibuat TANPA
kecamatan (kolom opsional, baru ada belakangan) sementara baris katalog hampir
selalu mengisinya — kunci tidak pernah sama. Ditambah nama desa yang ditulis
beda spasi antar sumber (`Kedungmutih` vs `Kedung Mutih`).

Sekarang ada DUA pembanding yang sengaja berbeda dan tidak boleh ditukar:

- `locationKey` — KETAT (termasuk kecamatan), untuk katalog ↔ katalog (dedup
  baris impor). Kedua sisi dari file yang sama, kecamatan pasti terisi.
- `existingLocationIndex` / `buildExistingLocationIndex` — untuk katalog ↔
  Location RIIL. Provinsi+kabupaten+desa harus sama; kecamatan cocok bila sama
  ATAU salah satu sisi kosong; semua perbandingan abai spasi & kapital. Desa
  senama di dua kecamatan berbeda yang dua-duanya terisi tetap dibedakan.

`existingLocationKeys` (pembanding lama untuk peran ini) DIHAPUS, bukan
dibiarkan menganggur — supaya tidak ada yang memungutnya lagi.

Hasil pada data dev: lolos 73 → 67, sisa bocor nol. Panel koreksi juga menyebut
jumlah baris yang disembunyikan, supaya "tidak muncul" tidak terbaca "tidak
ada", dan mengarahkan ke isian manual bila memang lokasi berbeda.

Verifikasi: unit 629 ✓ (10 kasus baru `location-match`, termasuk reproduksi dua
kasus bug nyata) · integrasi 151 ✓ · typecheck ✓ · lint ✓ (aturan baru menolak
`<select>`) · browser: 0 `<select>` di halaman, cari "tengket"/"ujungwatu"/
"kedungmutih" (sudah terpakai) → kosong, "sumberkima" (belum) → ketemu.

---

## 189 — Koordinat lokasi: satu aturan, satu tempat mengeditnya, dan tidak lagi hilang diam-diam (2026-07-31)

User: "bagaimana jika koordinat proyek berubah, aku tidak tau dimana harus edit
lat long nya." Formnya SUDAH ada sejak DECISIONS 134 — dan itu justru
masalahnya: tidak ada yang bisa menemukannya. Penelusuran menemukan tiga hal
sekaligus.

**(a) Tersembunyi.** Editor koordinat berada di dalam kartu berjudul **"Status
lokasi"**, di balik tombol **"Edit master data"**. Dua-duanya tidak menyebut
koordinat sama sekali. Sekarang koordinat punya kartu sendiri di `/lokasi/[slug]`
— **"Alamat & koordinat"** — menampilkan titik yang berlaku, tombolnya berbunyi
"Ubah alamat & koordinat", dan bila kosong ada peringatan yang menyebut
akibatnya (tak muncul di peta, cuaca otomatis mati, cap foto kehilangan titik
proyek). Ini pola yang sama dengan kekeliruan impor Drive: fitur yang ada tapi
tak terlihat sama saja dengan tidak ada.

**(b) Aturan koordinat berbeda-beda per pintu.** Form tambah lokasi target
menerima −90..90 / −180..180 (seluruh bumi); form edit membatasi ke wilayah
Indonesia; form koreksi lokasi (187) tidak punya input koordinat sama sekali
sehingga lokasi hasil koreksi manual SELALU lahir tanpa titik. Kini semua
melewati `src/lib/geo.ts`:

- kotak wilayah Indonesia (lat −11..6.5, lng 95..141.5) sebagai penyaring
  salah-ketik, bukan penentu batas negara;
- lat & lng wajib berpasangan — setengah koordinat menyesatkan peta;
- koma desimal gaya Indonesia diterima;
- **lat/lng tertukar dideteksi khusus** dan pesannya menyebutkan pasangan yang
  benar, karena itu kekeliruan yang paling sering terjadi;
- form koreksi lokasi kini punya input koordinat.

**(c) Lokasi tanpa koordinat lenyap dari peta tanpa jejak.** `getPetaMarkers`
memfilter `gpsLat/gpsLng not null`, jadi "tidak muncul" terbaca "tidak ada".
Halaman Peta kini menyebut jumlahnya dan menautkan tiap lokasi langsung ke
tempat koordinatnya diisi — sesuai aturan daftar-pilihan di `CLAUDE.md`.

Tidak diubah: koordinat `MasterLocation` (katalog) tetap hanya bisa diubah lewat
impor ulang .xlsx. Yang dipakai peta, cuaca, cap foto, dan rule GPS adalah
`Location.gpsLat/gpsLng` — dan itu sekarang bisa diedit dengan jelas.

Verifikasi: unit 639 ✓ (10 kasus baru `geo`: pasangan wajib, koma desimal,
tertukar, salah tanda, batas persis Sabang/Merauke) · integrasi 151 ✓ ·
typecheck ✓ · lint ✓ · browser: kartu "Alamat & koordinat" tampil, input
tertukar ditolak dengan saran pembetulan, dan setelah satu lokasi dikosongkan
koordinatnya halaman Peta menyebut "1 lokasi tidak tampil" + tautannya (data dev
dipulihkan setelah uji).

---

## 190 — Executive View ikut butuh penugasan lokasi (2026-07-31)

Permintaan user: "untuk level eksekutif viewer juga perlu penugasan, jadi tidak
semua lokasi otomatis eksekutif view bisa lihat."

Sebelum ini `exec_viewer` ada di `CROSS_LOCATION_ROLES`, jadi setiap akun
Executive View otomatis melihat SELURUH lokasi organisasi tanpa ditugaskan apa
pun. Sekarang ia keluar dari himpunan itu dan tunduk pada `LocationAssignment`
seperti Site Manager / Project Manager.

**Akun exec tanpa penugasan melihat NOL lokasi, bukan semuanya** (pilihan user).
Alasannya: kalau kosong berarti "semua", maka lupa menugaskan diam-diam membuka
seluruh portofolio — persis hal yang mau dicegah. Gagal ke arah aman.

Perubahannya satu tempat: `CROSS_LOCATION_ROLES` di `src/lib/authz.ts`. Baik
`accessibleLocationIds` (penyaring daftar) maupun `hasLocationAccess` (penjaga
per-lokasi, 128 pemanggil) sama-sama lewat `isCrossLocation`, jadi seluruh
halaman, server action, dan route handler ikut tanpa perubahan masing-masing.

**Yang TIDAK berubah**: `super_admin` dan `program_director` tetap lintas lokasi
(user memilih demikian). Kapabilitas LIHAT milik exec_viewer juga tidak dicabut
sama sekali — yang berubah hanya CAKUPAN lokasinya. Untuk exec tingkat nasional,
tugaskan seluruh lokasi ke akunnya.

**Halaman kosong harus menjelaskan dirinya.** Peran ter-scope tanpa penugasan
melihat nol data di mana-mana, dan itu terbaca "sistem rusak" atau "proyeknya
memang belum ada". Satu banner di `app/(app)/layout.tsx` menyebut sebabnya dan
apa yang harus dilakukan — sekali pasang, berlaku untuk semua halaman. Ini
penerapan aturan daftar-pilihan di `CLAUDE.md`: yang disembunyikan harus
disebut, jangan sampai "tidak muncul" terbaca "tidak ada".

`scripts/gen-permission-matrix.mts` dulu menuliskan daftar peran lintas-lokasi
secara hardcode di teks dokumen, sehingga PERMISSION_MATRIX.md langsung bohong
begitu konstantanya berubah. Kini baris itu dibangkitkan dari
`CROSS_LOCATION_ROLES`.

**Dampak rilis**: akun Executive View yang sudah ada (mis. `kkp-viewer`) menjadi
kosong sampai admin menugaskan lokasi. Itu konsekuensi yang disengaja, bukan
regresi.

Verifikasi: unit 640 ✓ · integrasi 160 ✓ (9 kasus baru `exec-viewer-scope` yang
memakai `accessibleLocationIds`/`hasLocationAccess` ASLI, bukan mock: tanpa
penugasan → nol lokasi & nol paket & URL lokasi tertutup; dengan penugasan →
hanya lokasi itu; penugasan dicabut → langsung tertutup; penugasan lintas-org
tetap ditolak; program_director tidak ikut berubah) · typecheck ✓ · lint ✓ ·
browser: `kkp-viewer` tanpa penugasan melihat 0 lokasi + banner penjelas,
setelah ditugaskan 1 lokasi melihat tepat 1 paket dengan KPI ikut ter-scope,
sementara admin tetap melihat 7 lokasi.

---

## 191 — Impor Drive tidak lagi menawarkan balik berkas terbitan MARLIN sendiri (2026-07-31)

Keluhan user: "marlin membaca file laporan yang dia upload sendiri, dan menambah
daftar file, merepotkan." Benar, dan itu lingkaran yang kita buat sendiri.

MARLIN mengunggah PDF/Excel laporan harian & mingguan ke folder KKP di Google
Drive (DECISIONS 143/146). Impor dokumen membaca folder yang SAMA. Penyaring
lama hanya mengecualikan berkas yang **sudah pernah diimpor** (`Document.
driveFileId`) dan berkas kebesaran — bukan berkas yang MARLIN sendiri terbitkan.
Akibatnya setiap laporan yang naik langsung muncul lagi sebagai "dokumen baru
siap diimpor", dan daftar impor tenggelam oleh terbitannya sendiri. Makin rajin
melapor, makin berantakan daftarnya.

**Dua penyaring, sengaja dua-duanya** — satu saja tidak cukup:

1. **Penanda di Drive.** Setiap unggahan MARLIN kini distempel `appProperties`
   `marlinTerbitan=1`. `appProperties` privat per-aplikasi: tidak terlihat
   pengguna, tidak mengotori tampilan Drive, dan **ikut terbawa walau berkas
   diganti nama atau dipindah folder**. Ini penyaring utama karena tidak
   bergantung pada database kita.
2. **Catatan `GDriveUpload`.** Berkas yang sudah terlanjur naik SEBELUM penanda
   itu ada tentu tidak punya `appProperties`. Untuk itu `fileId` unggahan
   berstatus `sukses` pada paket tsb ikut disaring. Tanpa ini perbaikan baru
   terasa untuk berkas baru saja, sementara keluhannya justru tentang yang sudah
   menumpuk.

Unggahan berstatus **gagal** tidak menyaring apa pun — berkasnya memang tidak
ada di Drive, dan kalau ada berkas senama milik KKP ia tetap harus bisa diimpor.

**Penjaga di sisi commit, bukan cuma tampilan.** `commitDriveImport` membaca
ulang metadata dari Drive (prinsip lama: jangan percaya klien) dan menolak
berkas ber-penanda. Pratinjau basi atau permintaan yang dijahili tidak bisa
menembus penyaring.

**Disembunyikan, bukan ditampilkan sebagai baris "dilewati".** Berkas terbitan
sendiri tidak informatif sebagai baris — datanya sudah ada di MARLIN. Tapi
jumlahnya DISEBUT ("N berkas tidak ditampilkan karena terbitan MARLIN sendiri"),
sesuai aturan daftar-pilihan di `CLAUDE.md`: yang disembunyikan harus disebut
supaya "tidak muncul" tak terbaca "tidak ada". Jumlahnya juga masuk audit log
pratinjau.

Yang TIDAK diubah: panel kelengkapan folder KKP tetap menghitung berkas terbitan
MARLIN sebagai "ada" — memang benar berkasnya ada di folder itu.

Verifikasi: unit 640 ✓ · integrasi 165 ✓ (5 kasus baru: laporan ber-penanda
hilang dari daftar & terhitung terpisah; berkas lama tanpa penanda tersaring
lewat GDriveUpload; unggahan gagal tidak menyaring; commit menolak berkas
terbitan sendiri; berkas KKP biasa tetap bisa diimpor) · typecheck ✓ · lint ✓.
Panggilan nyata ke googleapis.com tidak bisa dijalankan dari kontainer kerja
(proxy memblokir host luar) — klien Drive di-mock seperti uji impor yang sudah
ada; stempel `appProperties` pada unggahan sungguhan harus dipastikan di Railway.

---

## 192 — Buka kunci final yang buntu, cuaca/tenaga kerja yang tersembunyi, dan tombol Kembali cetak yang nyasar (2026-07-31)

Tiga temuan dari satu sesi pemakaian nyata.

### (a) Buka kunci final tidak menghasilkan apa-apa

`unfinalizeReport` memindahkan `final → disetujui` (DECISIONS 149). Tapi
`disetujui` TIDAK ada di `EDITABLE_STATUSES` (`draft`, `perlu_koreksi`) maupun
`ENRICHABLE_STATUSES`, dan satu-satunya panel yang muncul di status itu adalah
"Finalisasi Laporan". Jadi setelah membuka kunci, tidak ada satu pun yang bisa
diedit — persis pertanyaan user: "kenapa tidak ada edit apa pun, lalu apa
gunanya di revert dari final?"

Transisi `disetujui → perlu_koreksi` SUDAH sah di `lifecycle.ts` dan
`returnReport` sudah bisa melakukannya; yang hilang cuma tombolnya. Kini
`ReviewActions` punya mode `koreksi` yang tampil saat status `disetujui`:
hanya "Kembalikan untuk koreksi", tanpa "Setujui" (laporannya memang sudah
disetujui). Alurnya jadi dua langkah yang masing-masing tercatat: buka kunci
(super admin) → kembalikan untuk koreksi (pemegang review) → editable.

Panelnya menyebut terus terang bahwa **volume laporan berhenti dihitung di
progres & kurva-S** selama berstatus `perlu_koreksi` (status itu memang bukan
anggota `COUNTED_REPORT_STATUSES`) sampai dikirim & disetujui ulang. Angka
bergerak karena keputusan sadar pengguna, bukan efek samping diam-diam.

### (b) Cuaca & tenaga kerja tak terlihat oleh penulis laporannya sendiri

Panel "Pelengkap laporan KKP" (cuaca, jam kerja, tenaga kerja per keahlian,
material, alat) digerbang `canReview` di halaman — padahal server action SUDAH
mengizinkan PEMBUAT laporan mengisinya saat `draft`/`perlu_koreksi`
(`CREATOR_ENRICHABLE_STATUSES`). Akibatnya mandor yang menulis laporan tidak
pernah melihat kolom cuaca & tenaga kerja; hanya reviewer yang bisa. Gerbang UI
kini mengikuti aturan server: reviewer (draft/perlu_koreksi/dikirim) ATAU
pembuat (draft/perlu_koreksi).

Catatan: cuaca memang TIDAK punya pemilih manual — `SHOW_MANUAL_WEATHER_PICKER
= false`, diambil otomatis per jam dari koordinat lokasi lewat tombol "Ambil
cuaca otomatis". Karena itu lokasi tanpa koordinat membuat cuaca mati (lihat
DECISIONS 189).

### (c) Tombol Kembali di halaman cetak selalu ke daftar laporan lokasi

`backHref` dipaku ke `/lokasi/[slug]/laporan-lokasi` padahal halaman cetak
harian dicapai dari EMPAT tempat berbeda. Di halaman tujuan itu ada laporan
mingguan — maka keluhannya: "kadang ke laporan mingguan, padahal awalnya
laporan harian di hari tertentu."

Asal halaman kini dibawa lewat query `?dari=`, dan `src/lib/print-back.ts`
menyaringnya: hanya path internal absolut yang diterima; URL absolut,
protocol-relative (`//host`), backslash, dan `..` ditolak supaya parameter itu
tidak jadi celah open-redirect. Cadangannya bukan lagi daftar laporan, melainkan
dokumen itu sendiri (laporan harian tanggal tsb).

Verifikasi: unit 646 ✓ (6 kasus baru `print-back`, termasuk penolakan tujuan
luar) · integrasi 165 ✓ · typecheck ✓ · lint ✓ · browser: laporan final dibuka
kuncinya → panel "Kembalikan untuk diedit" muncul → status jadi Perlu Koreksi →
form item, cuaca, dan tenaga kerja semuanya tampil, dengan riwayat status
memuat kedua alasan; tombol Kembali cetak diuji 4 kasus (dua asal berbeda,
tanpa parameter, dan parameter berisi host luar) — semuanya mendarat benar.

---

## 193 — Doktrin AI Intelligence: mesin analisis & produksi artefak, bukan fitur visual/chatbot (2026-08-01)

Arahan user, berlaku sebagai prinsip produk (sejajar "AI bukan sumber angka"
di DECISIONS 133):

> AI Intelligence bukan fitur visual atau chatbot. AI Intelligence adalah mesin
> analisis dan produksi artefak. Setiap analisis yang relevan harus dapat
> berakhir menjadi laporan terstruktur yang dapat direview, di-approve,
> dibekukan, diekspor ke PDF/Excel, didistribusikan melalui WhatsApp, dan
> diaudit kembali.

Konsekuensi konkret — SEMUA pintu keluar AI harus bermuara ke lifecycle
artefak (`AiArtifact`: draft → direview → disetujui → beku → terkirim), tidak
boleh ada jalur yang berakhir di layar saja atau kirim tanpa review:

1. Report Studio sudah memenuhi (satu structuredContent → banyak renderer,
   distribusi hanya artefak beku). Ia menjadi SATU-SATUNYA pintu produksi
   artefak keluar.
2. Menu global `Laporan → WA` (modul exec-report) DILEBUR ke Report Studio —
   ia jalur AI kedua yang paralel: generate → langsung kirim WA, tanpa
   review/versi/beku. Route lama dialihkan; fungsi tujuan bebas (kontak
   tersimpan / nomor manual / grup) dipertahankan di distribusi artefak.
3. Halaman hasil run (`/ai/run/[id]`) mendapat jembatan "Jadikan laporan":
   scope run terbawa ke Report Studio dengan template yang sesuai jenis
   analisisnya. Angka SELALU dihitung ulang dari calculation layer saat
   generate — run lama tidak dibekukan mentah menjadi laporan, karena itu
   akan mengawetkan angka basi (prinsip DECISIONS 133 menang).
4. Ask MARLIN mendapat jalur yang sama: jawaban bisa dibawa ke Report Studio
   (scope percakapan terbawa), bukan berhenti sebagai teks percakapan.

Aturan ini tertulis juga di PROJECT.md §5a. Pelanggaran = bug arsitektur,
bukan preferensi.

---

## 194 — Eksekusi doktrin 193: Laporan → WA dilebur ke Report Studio + jembatan run & Ask (2026-08-01)

Eksekusi konsekuensi DECISIONS 193. Yang berubah:

**(a) Menu global `Laporan → WA` DIHAPUS; route `/laporan-wa` dialihkan** ke
`/ai/reports?template=wa_update`. Modul `src/lib/exec-report/` dihapus utuh —
ia jalur AI paralel tanpa review/versi/beku: teks hasil generate bisa diedit
bebas lalu langsung dikirim. Semua fungsinya berpindah:

- Preset "Status Kepatuhan Lapor" → template Report Studio `kepatuhan_lapor`
  (preset lain sudah punya padanan: rangkuman ≈ `exec_portfolio`, rekap
  kendala ≈ `kendala_recovery`). Total template kini 8.
- Periode `hari_ini` & `kemarin` (khas update harian pimpinan) ditambahkan ke
  preset periode Report Studio.
- **Distribusi artefak beku kini menerima kontak tersimpan ATAU tujuan bebas**
  (nomor / id grup via `normalizeWaTarget`) — fungsi bawaan menu lama yang
  sebelumnya tidak ada di jalur artefak. Nama+chatId tujuan tercatat di
  `distributions` dan audit.
- Slot prompt `exec.*` (4) dihapus dari registri; `aiComplete()` yang menjadi
  yatim ikut dihapus. Model `ReportDispatch` DIPERTAHANKAN sebagai riwayat
  historis (tidak ada tulisan baru ke sana).

**(b) Capability dibereskan, bukan sekadar dicabut.** `exec_report.send`
ternyata juga menggerbangi Chat Grup + kelola kontak WA — bukan urusan
laporan. Ia diganti `wa.chat` dengan pemegang PERSIS sama (SM ke atas; tidak
ada perubahan hak). Untuk kemampuan kirim yang hilang: **site_manager diberi
`ai.report_send`** — SM tetap bisa mengirim ke WA seperti dulu, tapi kini
HANYA artefak yang sudah dibekukan atasannya, bukan teks bebas hasil generate
sendiri. Ini pengetatan, bukan perluasan. RM/PM/PD/SA tidak berubah.

**(c) Jembatan sesuai doktrin**: halaman run analisis (`/ai/run/[id]`, status
siap) punya "Jadikan laporan →" yang membawa scope run ke Report Studio dengan
template sesuai jenis (risiko → `kendala_recovery`, lainnya →
`exec_portfolio`); Ask MARLIN punya "Buat laporan dari scope ini →" (template
`wa_update`). Dua-duanya MENGHITUNG ULANG angka dari calculation layer saat
generate — run/jawaban lama tidak dibekukan mentah jadi laporan (angka basi).
Report Studio menerima `?template=` & `?scopeIds=` (scope disaring terhadap
izin user sebelum dipakai).

Verifikasi: unit 645 ✓ · integrasi 165 ✓ · typecheck ✓ · lint ✓ ·
PERMISSION_MATRIX diregenerasi (47 capability) · browser: `/laporan-wa` (admin
& SM) mendarat di Report Studio dgn template WhatsApp Update terpilih, template
kepatuhan tampil, nav bersih, SM tetap bisa buka Master → Kontak. Kirim WA
tujuan bebas belum teruji ujung-ke-ujung (butuh provider AI + WAHA hidup —
hanya ada di Railway); jalur normalisasi tujuannya sudah ter-unit-test lama.

---

## 195 — "Draft saran" tidak lagi jalan buntu: bisa diterapkan jadi Kendala nyata (2026-08-01)

Laporan user: di Perlu Tindakan, menekan **Draft recovery** hanya menaikkan
angka KPI "menunggu tindak lanjut manual" — *"aku tidak melihat apapun yang
nyata, di halaman lokasi pun tidak ada apapun"*. Benar seluruhnya.

**Apa yang sebenarnya terjadi sebelum ini.** `saveSuggestionAction` membuat
`AiArtifact` kind `saran` status `draft`, lalu selesai. Artefak itu tidak
pernah muncul di mana pun: `/ai/actions` hanya `count()` tanpa daftar,
`/ai/reports` hanya melistkan kind `laporan`, dan kartu `saran` di halaman run
tidak punya aksi apa pun (bahkan isinya tidak ditampilkan). Jadi tombol itu
menulis ke tempat yang tak terbaca — write-only counter. Ini persis pelanggaran
doktrin DECISIONS 193.

**Prinsip DECISIONS 133 TIDAK diubah**: AI tetap tidak pernah menulis
Issue/RecoveryAction sendiri. Yang ditambahkan adalah jalan eksekusi
manusianya, yang selama ini hilang:

1. **Antrean draft jadi nyata di layar.** `/ai/actions` kini menampilkan
   DAFTAR draft tersimpan (judul, lokasi), bukan sekadar angka. Daftarnya juga
   difilter ke lokasi dalam scope user — `count()` lama menghitung lintas
   organisasi (kebocoran angka multi-tenant).
2. **`terapkanSaranAction`**: satu tombol mengubah draft menjadi `Issue` nyata
   di lokasi tsb; untuk draft ber-jenis `recovery` sekalian dibuat
   `RecoveryAction` (PIC & tanggal target opsional, ditanyakan di form) dan
   Kendala langsung berstatus `ditangani` — sama seperti alur manual di
   workspace lokasi. Semua dalam satu transaksi + `auditIn`
   (`ai.saran.terapkan`, resource `issue`, memuat artifactId).
3. **Gerbangnya capability DOMAIN, bukan AI**: `issue.manage` +
   `requireLocationAccess`. Pemegang `ai.generate` tanpa izin Kendala (mis.
   exec_viewer) tetap bisa membuat draft, tapi tidak bisa menerapkannya — AI
   tidak boleh jadi pintu belakang ke data domain.
4. **Draft yang diterapkan keluar dari antrean**: status → `terkirim` dan
   `issueId` ditulis balik ke `structuredContent` sebagai tautan. Penerapan
   kedua kali ditolak.

Verifikasi: 8 kasus integrasi baru (`terapkan-saran`) — Issue+Recovery benar
terbentuk dgn PIC/tanggal, draft action hanya bikin Kendala terbuka, audit
tertaut, tanpa izin ditolak, lokasi di luar penugasan ditolak, tidak bisa
diterapkan dua kali, draft tanpa lokasi ditolak, artefak laporan tidak bisa
lewat pintu ini · typecheck ✓ · lint ✓ · browser: tekan Draft Recovery → panel
"Draft saran tersimpan" muncul → Terapkan → Kendala "Batah Timur: Deviasi
jadwal -77.3 pp" (Kritis, Ditangani) beserta aksi pemulihannya TAMPIL di
halaman lokasi.

---

## 196 — Output AI harus punya isi: sections/rekomendasi ikut terkirim, status jujur soal data kosong (2026-08-01)

**Konteks.** User: *"laporan wa yang kamu merger ke sana, sama sekali tidak
berguna sekarang… coba lihat, apa manfaat output seperti ini, apa yang dikirim
ke direksi"*. Setelah diperiksa satu per satu, seluruh menu AI Intelligence
memang menghasilkan artefak yang secara isi nyaris kosong. Enam sebabnya
berbeda-beda dan semuanya di sisi kode, bukan di prompt:

1. **Renderer WA membuang isi laporannya.** `renderAiReportWhatsApp` hanya
   memakai `title`, `waSummary`, dan tabel angka. `sections[]` dan
   `recommendations[]` — bagian yang justru menjawab "apa yang terjadi" dan
   "apa yang harus dilakukan" — tidak pernah dirender sama sekali, dan
   `limitations` cuma diambil elemen pertamanya. Padahal `renderedText` inilah
   yang dibekukan dan dikirim ke pimpinan. Sekarang WA memuat blok
   *Catatan lapangan* (maks 5 section, body dipotong rapi di batas kata) dan
   *Tindakan yang disarankan* (maks 5, bernomor), plus seluruh keterbatasan.

2. **Status "Kritis" untuk portofolio yang laporannya belum masuk.** Deviasi
   −90 pp karena tidak ada satu pun laporan final BUKAN pekerjaan mandek —
   itu data kosong. Ditambahkan aturan deterministik (bukan imbauan prompt):
   `dataBelumMemadai()` — laporan final < 25% dari yang seharusnya, atau tidak
   ada kewajiban lapor sama sekali → `statusEfektif()` MEMAKSA `data_kurang`,
   apa pun yang ditulis AI, dan pesan dibuka dengan kalimat yang menyebut
   sebabnya. Baris lokasi tanpa laporan final pun ditulis
   "belum ada laporan final (0/30) · rencana 68.0%", bukan "realisasi 0.0%".

3. **Label "draf" ikut membeku.** `renderedText` dibuat saat transisi ke `beku`
   dengan footer "Draf AI MARLIN — narasi perlu review manusia", lalu teks itu
   yang terkirim. Pesan yang sudah lolos review sampai ke pimpinan berlabel
   draf mentah. Renderer kini menerima `sudahFinal`; freeze, distribusi, dan
   halaman cetak meneruskan status artefak yang sebenarnya.

4. **Kolam angka grounding tercampur satuan.** `officialNumbersByLocation` dan
   `globalNumbers` mencampur persen dengan hitungan (jumlah foto, jumlah
   laporan, minggu, hari, skor risiko), padahal `extractNumericClaims` hanya
   menangkap klaim ber-"%"/"pp". Akibatnya klaim "rencana 130,0%" lolos hanya
   karena ada lokasi dengan `photoCount` 130 — validator grounding-nya bocor.
   Kolam dipersempit ke satuan persen saja.

5. **`executiveSummary` & `title` tidak pernah divalidasi.** Pemeriksaan
   generik menyasar `output.summary` yang tidak ada di skema laporan, jadi
   lewat diam-diam — padahal keduanya tampil di panel, PDF, dan Excel.
   Ringkasan yang angkanya tak bersumber kini diganti penanda eksplisit +
   `droppedNote`; judul bermasalah ditandai untuk diperiksa manual.

6. **Lokasi tanpa RAB tampak "Memadai".** Syarat lama
   `hasActiveRab && !hasActiveBaseline` membuat lokasi tanpa RAB hanya
   kehilangan 30 poin → skor 70 → grade "Memadai". Lokasi yang datanya kosong
   total tampak sehat, tidak masuk daftar readiness rendah, tidak memicu rule
   risiko — sehingga Perlu Tindakan bisa menyatakan "tidak ada masalah" untuk
   portofolio yang belum berisi apa pun. Tanpa RAB, baseline mustahil ada:
   potongannya sekarang ikut jatuh (→ `poor`).

**Ikutan.** Filter organisasi di `/ai/history`, `/ai/reports`, dan
`/ai/actions` dipindah KE DALAM query (`createdById: { in: … }` /
`userId: { in: … }`) — sebelumnya menyaring setelah `take`, sehingga daftarnya
bisa kosong padahal ada isinya, dan KPI "Draft saran" melaporkan angka yang
sudah terpotong. Kartu artefak `saran` di halaman run juga menampilkan isinya
(dulu dipetakan ke string kosong) + tautan ke antrean penerapannya.

**Verifikasi**: 15 kasus unit baru (`ai-laporan-isi`) mengunci isi WA, batas
jumlah butir, pemotongan di batas kata, ambang data kosong, status efektif
WA+HTML, footer per status, dan readiness lokasi tanpa RAB · unit 660 ✓ ·
integrasi 173 ✓ · typecheck ✓ · lint ✓.

---

## 197 — Cap foto hanya boleh menyatakan apa yang benar-benar diketahui + arsip berkas asli (2026-08-01)

**Konteks.** User menunjuk satu foto Pengaradan dan bertanya tiga hal berturut-
turut. Ketiganya bug, sebabnya berbeda-beda, dan ketiganya membuat sistem
menyatakan sesuatu yang lebih pasti daripada datanya.

**1. "GPS ✓" padahal koordinatnya dari database.** `savePhotoForItem` menyimpan
koordinat APA PUN yang dicap ke kolom `exif_gps_lat/lng` — termasuk titik lokasi
proyek yang dipakai sebagai CADANGAN saat foto tidak membawa GPS. Kolomnya
bernama `exif_*`, jadi seluruh hilir memperlakukannya sebagai bukti EXIF:
galeri (`hasGps: exifGpsLat != null`), KPI "Tanpa GPS", `photosNoGps` di
readiness, dan rule kualitas radius GPS. Efek terburuknya di rule radius: foto
ber-cadangan jaraknya PASTI nol dari titik proyek, jadi rule itu selalu lulus
justru pada foto yang tidak punya bukti posisi sama sekali.

Ditambahkan enum `PhotoGpsSource` (`exif`/`device`/`project`/`none`) dan kolom
`photos.gps_source` — sumber KOORDINAT dipisah dari sumber WAKTU
(`metadata_source`) karena keduanya memang bisa berbeda. Backfill menandai
`project` untuk baris yang koordinatnya persis sama dengan `gps_lat/gps_lng`
lokasinya (peluang GPS asli identik sampai 7 desimal ~ nol), sisanya `exif`.
Sejak sekarang: galeri punya TIGA keadaan ("GPS ✓" / "GPS titik proyek" /
"Tanpa GPS"), `photosNoGps` & rule radius hanya menghitung GPS asli, dan capnya
sendiri menulis penanda kuning "· titik proyek" di sebelah koordinat.

**2. Jam "07:00 WIB" di hampir semua foto.** `activity_date`/`report_date`
adalah kolom `@db.Date`, jadi Prisma mengembalikannya sebagai tengah malam UTC.
Diformat ke Asia/Jakarta, tengah malam UTC = **tepat 07:00**. Jadi angka jam itu
bukan data sama sekali — itu offset zona waktu yang tercetak sebagai fakta. Lebih
buruk lagi penandanya berbunyi "waktu unggah", padahal itu bukan waktu unggah
maupun waktu jepret.

Sekarang: kalau jam jepret tidak diketahui, cap menulis TANGGAL SAJA
("Jumat, 31 Juli 2026") dengan penanda "jam tidak tercatat". Penanda
"waktu unggah" dipakai hanya bila waktunya memang waktu unggah. Jam jepret asli
(EXIF / perangkat / nama berkas WhatsApp) tetap tampil lengkap seperti biasa.

**3. "Foto asli tanpa cap juga disimpan — di mana saya bisa cek?"** Jawaban
jujurnya: TIDAK ADA. `savePhotoForItem` hanya menyimpan hasil kompresi+cap
(`r2Key`) dan thumbnail; berkas aslinya dibaca ke memori untuk EXIF & sha256,
lalu dibuang. Satu-satunya jejak yang tersisa adalah hash-nya.

**Kenapa terlewat — ini kegagalan proses, bukan kelalaian teknis.** User
menegaskan bahwa penyimpanan berkas asli SUDAH pernah dia minta sebelumnya,
justru untuk keadaan seperti ini (bila cap perlu diperbaiki). Permintaan itu
tidak pernah masuk ke `docs/DECISIONS.md`, tidak ada di dokumen mana pun, dan
tidak ada commit yang pernah menyentuhnya — dicek dengan
`git log --all -S originalKey` (hasil: nihil sampai DECISIONS 197 ini).
Instruksinya hanya hidup di percakapan. Padahal CLAUDE.md poin 6 mewajibkan
keputusan baru di-append ke DECISIONS.md — kalau itu dijalankan waktu itu,
sesi-sesi berikutnya akan menemukannya. Karena tidak tercatat, setiap sesi
berikutnya membaca KODE sebagai satu-satunya sumber, dan kode tidak menyimpan
apa pun. Pelajarannya: instruksi user yang mengubah perilaku sistem harus
ditulis SAAT diterima, bukan saat dikerjakan.

Ditambahkan `photos.original_key` + `original_bytes`: byte asli diunggah apa
adanya ke `…/<uuid>.asli.<ext>`. Best-effort — gagal mengarsip tidak
menggagalkan unggahan (versi ber-cap sudah aman), dan rollback ikut menghapusnya.
Diunduh lewat `/api/foto-asli/<id>`, SENGAJA di luar `/api/foto` yang PUBLIK
(link token HMAC untuk PDF WA): berkas asli wajib sesi + akses lokasi. Foto lama
dijawab 404 dengan penjelasan, bukan pesan menyesatkan — arsipnya memang tidak
pernah ada dan tidak bisa dibuat surut.

**4. Ikutan — "Upload Drive" pada dokumen yang DITARIK dari Drive.** Kolom Drive
KKP di `/dokumen` menawarkan tombol unggah untuk baris yang keterangannya
sendiri berbunyi "· dari Drive KKP": mengunggah balik berkas milik KKP ke folder
KKP. Ini lingkaran yang sama dengan impor yang membaca terbitan sendiri
(DECISIONS 191). Sekarang baris ber-`source = drive_kkp` menampilkan tautan
"Lihat di Drive KKP", dan `uploadDocumentToDriveAction` MENOLAKNYA di server —
bukan sekadar tombolnya disembunyikan.

**Verifikasi**: 11 kasus unit baru (`cap-foto-jujur`) — termasuk bukti sebab
"07:00" (DATE tengah malam UTC → 07:00 WIB) dan penanda yang ter-escape · 3
kasus integrasi baru di `dokumen-impor-drive` · unit 671 ✓ · integrasi 176 ✓ ·
migrasi idempoten ✓ · typecheck ✓ · lint ✓.

**Belum selesai (jujur):** foto yang sudah terlanjur diunggah tidak bisa
diperbaiki capnya — gambarnya sudah dibakar. Yang berubah surut hanya
KLASIFIKASINYA (`gps_source`), sehingga galeri, KPI, dan rule berhenti
menganggapnya bukti GPS. Cap "07:00" di foto lama tetap ada di gambarnya.

---

## 198 — Perbaikan cap foto + pengelolaan arsip berkas asli (2026-08-01)

**Konteks.** User: *"foto asli nanti bisa dihapus, tapi atas mauku, jadi ada
halaman atau fitur khusus untuk itu. lalu ada fitur perbaikan stamp, itu tujuan
utamaku. jadi kalau ada kesalahan masih bisa diperbaiki"*. Dua fitur yang saling
bergantung dan saling meniadakan: perbaikan cap MEMBUTUHKAN arsip asli
(DECISIONS 197), penghapusan arsip MENIADAKANNYA.

**Kenapa harus dari berkas asli.** Cap dibakar ke piksel. Mengecap ulang di atas
gambar yang sudah ber-cap menumpuk dua cap dan cap lama tetap terbaca di
bawahnya. Jadi `restampPhotoAction` selalu mulai dari `originalKey`, memakai
pipeline yang SAMA dengan unggahan pertama (`processWithSharpOrOriginal`
diekspor untuk itu) — kalau tidak, foto ber-cap perbaikan akan beda ukuran,
kualitas, dan tata letak dari foto biasa.

**Semua teks cap boleh diedit** (pilihan user). Risikonya nyata: cap bisa
menyatakan apa saja. Ditanggung dengan tiga hal, bukan dengan melarang:
1. **Alasan wajib** — perbaikan tanpa alasan ditolak.
2. **Nilai manual ditandai di capnya sendiri.** Koordinat yang diketik →
   `gpsSource = manual` + penanda "diisi manual"; waktu manual → "diisi manual".
   Koordinat yang persis sama dengan titik proyek tetap `project`, bukan
   `manual` — menandai cadangan sistem sebagai pernyataan manusia sama
   menyesatkannya dengan sebaliknya.
3. **Riwayat append-only.** `photo_stamp_revisions` (trigger DB melarang
   UPDATE/DELETE) menyimpan nilai sebelum→sesudah + daftar field yang diketik.
   Karena versi ber-cap lama DIBUANG, baris inilah satu-satunya catatan apa yang
   dulu tertulis di foto itu.

**Yang TIDAK ikut berubah.** `stampPhotoId` (kolom baru) menyimpan Photo ID yang
tercetak, supaya identitas foto tetap sama setelah perbaikan — ID itu sudah
beredar di berkas yang diserahkan ke KKP. Foto lama yang belum punya dibuatkan
sekali lalu disimpan.

**Penghapusan arsip** (`/sistem/arsip-foto`): ringkasan pemakaian penyimpanan
lebih dulu — keputusan membuang arsip bukti hanya masuk akal kalau alasannya
terlihat — lalu penghapusan per foto (dari galeri) atau borongan berfilter
paket/lokasi/rentang tanggal, dengan konfirmasi mengetik "HAPUS". TIDAK ADA
penghapusan otomatis dan tidak ada retensi diam-diam.

Barisnya tidak dihapus: `originalKey` dikosongkan dan `originalPurgedAt` diisi,
sehingga **"tidak pernah diarsipkan" tetap bisa dibedakan dari "dihapus
sengaja"** — tanpa itu pesan di UI akan berbohong pada kasus kedua. Objek R2
dihapus DULU, baris ditandai hanya bila objeknya benar-benar hilang; kalau
dibalik, akan ada baris yang mengaku sudah dihapus padahal berkasnya masih
memakan penyimpanan.

**Izin**: `photo.restamp` + `photo.archive_purge`, keduanya super_admin +
program_director. Dipisah menjadi dua capability karena akibatnya berbeda:
yang satu menulis ulang bukti, yang satu membuang kemampuan menulis ulang.

**Verifikasi**: 17 kasus integrasi baru (`perbaikan-cap`) — render dari asli
(arsip asli TIDAK ikut terhapus, cap lama dibuang), riwayat sebelum→sesudah,
`manual` vs `project`, mengosongkan koordinat, revisi berurut, alasan wajib,
tanpa-perubahan ditolak, koordinat luar Indonesia ditolak, izin & scope, dan
sambungan purge→restamp (pesan penolakan dibedakan) · unit 683 ✓ · integrasi
203 ✓ · typecheck ✓ · lint ✓.

**Catatan jujur**: foto yang diunggah sebelum DECISIONS 197 tidak punya arsip
asli, jadi capnya tetap tidak bisa diperbaiki. Fitur ini menolong foto yang
diunggah sejak arsip aktif — dan itu tidak bisa diubah surut.

---

## 199 — Peran Wakil PPK: baca saja, tanpa AI, sesuai penugasan (2026-08-01)

**Konteks.** User: *"aku butuh satu lagi level login, Wakil PPK. tanpa fitur ai
intelegence. hanya bisa view saja, tanpa bisa edit sedikitpun. sesuai penugasan
juga"*.

Wakil PPK adalah wakil PEMBERI KERJA — pihak di luar pelaksana. Karena itu
batasannya bukan sekadar "sedikit capability", melainkan tiga garis tegas:

1. **Tanpa satu pun capability yang mengubah data.** Dijaga tes yang menyaring
   `[...ROLE_CAPABILITIES.wakil_ppk]` dan menuntut semuanya berakhiran `.view`
   (plus `report.export`). Aturan ini otomatis mencakup capability BARU: begitu
   ada yang tak sengaja diberikan ke peran ini, tesnya gagal tanpa perlu
   diperbarui.
2. **Tanpa `ai.*` sama sekali.** Narasi AI adalah draf internal yang wajib
   direview manusia (DECISIONS 193); ia tidak boleh sampai ke pemberi kerja
   sebagai kesimpulan MARLIN.
3. **Tanpa `finance.view`** (dijawab user: tidak). Menu Keuangan di sini adalah
   uang INTERNAL pelaksana — komitmen, invoice, pengeluaran — bukan urusan
   pemberi kerja. Nilai kontrak & termin tetap terlihat lewat Paket/Kontrak.

**Sesuai penugasan**: BUKAN `CROSS_LOCATION_ROLES`. Tanpa penugasan → nol
lokasi, gagal ke arah aman (prinsip yang sama dgn exec_viewer, DECISIONS 190).

**Ikutan.** `scripts/gen-permission-matrix.mts` dan
`tests/unit/permission-matrix-doc.test.ts` sama-sama memakai daftar role
HARDCODE, jadi peran baru tidak muncul di matriks dan tesnya tetap hijau-palsu.
Keduanya kini menurunkan daftarnya dari `ALL_ROLES` — persis alasan dokumen itu
dibangkitkan otomatis.

**Verifikasi**: 10 kasus unit baru (`wakil-ppk`) · matriks izin 8 role ✓.

---

## 200 — Ganti peran akun (2026-08-01)

**Konteks.** User: *"perlu bisa ganti jenis / level login, misal saat ini
pelaksana, diganti jadi site manager."*

Ini mutasi paling berbahaya di modul pengguna — satu langkah bisa menaikkan
seseorang ke wewenang yang tidak dimaksudkan. Pagarnya bertumpuk dan SEMUANYA di
server (tombol yang disembunyikan bukan kontrol):

1. `user.manage` + satu organisasi (AUTH-03).
2. **Tidak bisa mengganti peran akun sendiri** — kalau boleh, seorang admin bisa
   menaikkan dirinya sendiri dan seluruh hierarki jadi hiasan.
3. Hanya akun yang peringkatnya DI BAWAH aktor (DECISIONS 165, sama seperti
   reset password & nonaktifkan).
4. Peran TUJUAN dibatasi `canCreateRole` — aktor tidak bisa memberikan peran
   yang dia sendiri tidak boleh membuatnya (PD tidak bisa mengangkat SA).
5. Menurunkan admin aktif TERAKHIR ditolak — hasilnya organisasi terkunci dari
   sistemnya sendiri.

**Sesi lama dicabut** setelah peran berubah: capability dibaca dari sesi, jadi
tanpa pencabutan penurunan peran baru berlaku ketika sesinya kedaluwarsa —
jendela yang tidak boleh ada.

**Penugasan lokasi TIDAK ikut berubah**: peran menentukan APA yang boleh
dilakukan, penugasan menentukan DI MANA. Kalau peran barunya lintas-lokasi,
penugasan lamanya cuma tidak terpakai — dan berlaku lagi bila diturunkan.

**Catatan cakupan**: gerbangnya `user.manage`, jadi Project Manager TIDAK bisa
mengganti peran meski bisa MEMBUAT akun (`user.create`). Itu disengaja: merekrut
orang baru berbeda wewenang dari menaikkan orang yang sudah ada.

**Verifikasi**: 10 kasus integrasi baru (`ganti-peran`) — Pelaksana → Site
Manager berhasil + sesi dicabut + audit `user.set_role` memuat dari/ke,
penugasan tidak terhapus, peran sama ditolak, akun sendiri ditolak, akun
setingkat/lebih tinggi ditolak, PM ditolak seluruhnya, PD tidak bisa mengangkat
SA, peran liar ditolak skema, dan Wakil PPK bisa diberikan seperti peran lain.

---

## 201 — Daftar lokasi di dalam paket ikut penugasan (2026-08-01)

**Konteks.** User: *"di paket A, ada lokasi A,B,C,D — user di assign B,C. saat
masuk paket, lalu lihat lokasi, semua lokasi terlist. padahal dia cuma diberi
akses B,C. klik A, memang 404, tapi kalau bisa sekalian dibatasi sejak level
tampilan"*.

`getPackageWorkspace` sudah menjaga AKSES PAKETNYA (`packageScopeWhere`), tapi
begitu paketnya boleh dibuka, `locations` diambil seluruhnya. Penahanan di klik
memang mencegah akses datanya — tapi keberadaan dan NAMA lokasi lain sudah
terlanjur terkirim ke browser, dan daftar itu terbaca sebagai "ini semua
tanggung jawabmu", yang salah.

`locations` kini disaring `{ id: { in: scoped } }` (untuk role lintas lokasi
`scoped = null` → tanpa filter, tidak berubah). Jumlah yang disembunyikan
dikembalikan sebagai `locationsHidden` — aturan yang sama dengan katalog lokasi
(DECISIONS 189): yang tidak muncul harus disebut jumlahnya supaya tidak terbaca
"tidak ada".

**Dua ikutan yang WAJIB, bukan opsional** — begitu daftarnya disaring, angka
turunannya ikut menyempit dan bisa berbohong:

1. **KPI "Jumlah lokasi" & "Progress agregat"** dihitung dari lokasi yang
   TERLIHAT. Untuk user ber-scope sempit itu bukan angka paket seutuhnya, jadi
   labelnya berganti menjadi "Lokasi Anda di paket ini" dan "Progress lokasi
   Anda · bukan progres seluruh paket". Satu label untuk dua angka berbeda
   adalah persis yang dilarang Calculation Integrity Protocol.
2. **Panel rekonsiliasi kontrak vs Σ RAB DISEMBUNYIKAN** bila ada lokasi
   tersembunyi. Perbandingan itu memerlukan RAB SELURUH lokasi; dihitung
   sebagian, selisihnya akan tampak besar dan salah. Diganti Banner yang
   menyebut alasannya — lebih baik tidak menampilkan angka daripada menampilkan
   angka yang tidak mungkin benar.

Halaman lain yang memakai `pkg.locations` ikut aman dengan sendirinya:
`dokumen` (pilihan lokasi memang harus ter-scope) dan `kontrak` (hanya bisa
dibuka pemegang `contract.manage` = super_admin & program_director, keduanya
lintas lokasi sehingga `locationsHidden` selalu 0).

**Verifikasi**: 4 kasus integrasi baru (`paket-lokasi-scope`) — hanya B & C yang
muncul dan id/nama A & D tidak pernah ikut dalam data halaman, jumlah
tersembunyi = 2, scope kosong → nol lokasi dgn angka tersembunyi utuh, dan
super_admin tetap melihat keempatnya · unit 683 ✓ · integrasi 207 ✓ ·
typecheck ✓ · lint ✓.

---

## 202 — Penjadwal harian: SPMK terjadwal + pengingat WA laporan harian (2026-08-01)

**Konteks.** Dua permintaan yang ternyata berbagi satu kebutuhan. User:
*"pengguna seharusnya ada nomor wa yang diisi, lalu aku ingin tiap hari ada auto
wa ke tiap penanggung jawab, bahwa laporan hari ini sudah diinput atau belum"* —
dan, di pesan yang sama, temuan: *"hari ini tanggal 1 agustus, sengaja aku input
SPMK tanggal 3 agustus, kenapa sistem memposisikan sudah pelaksanaan?"*

### Bug SPMK

`startPelaksanaan` TIDAK PERNAH membandingkan tanggal SPMK dengan hari ini.
Begitu tombolnya ditekan, paket langsung `stage = pelaksanaan` dan semua
lokasinya jadi `berjalan`, apa pun tanggal yang diisi. Akibatnya, dua hari
sebelum pekerjaan boleh dimulai:

- `currentWeekNumber` menghasilkan minggu 0 lalu **di-clamp ke 1**, jadi rencana
  minggu 1 terbaca sebagai target yang seharusnya sudah tercapai → **deviasi
  negatif palsu**;
- menu Hari Ini meminta laporan untuk tanggal sebelum SPMK;
- (dan nanti) pengingat WA akan menagih laporan untuk hari yang pekerjaannya
  belum boleh dimulai.

Perbaikan: SPMK bertanggal masa depan **dicatat** (`Contract.startDate`) tetapi
paket TETAP `kontrak`; penjadwal harian menaikkannya pada tanggalnya. Sekaligus
`currentWeekNumber` kini mengembalikan **0 = belum mulai** dan
`planPctAtWeek(…, 0)` mengembalikan **0%**, bukan rencana minggu 1 — supaya
angkanya tetap benar bahkan bila ada jalur lain yang meloloskan tanggal mundur.

### Penjadwal

`POST /api/cron/harian` + header `x-cron-secret` (env `CRON_SECRET`), dipicu
penjadwal LUAR (Railway Cron) sekali sehari — disarankan 16:00 WIB = 09:00 UTC.
Bukan sesi: penjadwal tidak punya cookie. Tanpa/salah rahasia dijawab **404**,
bukan 401, supaya keberadaan endpoint-nya tidak bisa dipetakan; perbandingannya
`timingSafeEqual`. `CRON_SECRET` kosong = endpoint menolak semua (fitur mati,
bukan terbuka).

**Aman dipicu berkali-kali**, dan ini bukan sekadar kerapian: pekerjaan
otomatis yang dobel = pesan WA dobel ke HP orang lapangan.
- Aktivasi SPMK membaca ulang status DI DALAM transaksi (bisa berbarengan dengan
  tombol manual).
- Pengingat dijaga `UNIQUE (user_id, date_key)` di `daily_reminder_logs`, dan
  barisnya ditulis **sebelum** pesan dikirim — kalau dibalik, gagal mencatat
  berarti kirim ulang.

### Pengingat

`User.waNumber` (dinormalkan `normalizeWaTarget` sekali saat disimpan; kosong =
tidak dikirimi apa pun, dan itu dikatakan di formnya). Penerima: **pemegang
penugasan aktif di lokasi itu** — PM/AM sengaja tidak ikut (keputusan user).

Dikirim **sekali sehari, HANYA ke yang belum lengkap**. Yang sudah mengirim
tidak diganggu: pengingat yang datang tiap hari tanpa peduli isinya akan
berhenti dibaca dalam seminggu, dan pengingat yang tidak dibaca sama saja dengan
tidak ada. Satu orang tiga lokasi → SATU pesan tiga baris. "Belum ada laporan"
dibedakan dari "masih DRAF" — dua masalah berbeda. Lokasi yang SPMK-nya belum
tiba tidak ditagih.

### Ikutan

`changedById` pada `package_stage_history` & `location_status_history` kini
NULLABLE: aktivasi terjadwal dilakukan SISTEM, dan mengisinya dengan user mana
pun akan memalsukan siapa yang bertindak. Ditampilkan sebagai
"Sistem (terjadwal)", bukan "—" yang terbaca seolah pelakunya tak diketahui.

**Verifikasi**: 9 kasus unit baru (`pengingat-harian` — isi pesan, bedakan draf,
satu pesan per orang, plus BUKTI minggu-0: `currentWeekNumber(SPMK 3 Agt, …, 1
Agt)` = 0 dan `planPctAtWeek(kurva, 0)` = 0) · 13 kasus integrasi baru
(`tugas-harian` — SPMK masa depan tidak diaktifkan, aktif pada tanggalnya,
riwayat mencatat SISTEM, idempoten, pengingat hanya ke yang belum lapor,
idempoten, tanpa nomor dilewati, SPMK belum tiba tidak ditagih, WAHA mati tidak
melempar error, kegagalan tercatat sebagai gagal) · unit 693 ✓ · integrasi 220 ✓
· typecheck ✓ · lint ✓.

**Yang belum**: penjadwalnya belum dipasang di Railway — `CRON_SECRET` harus
diisi dan cron job dibuat. Sampai itu dilakukan, endpoint-nya menolak semua
permintaan dan kedua fitur ini tidak berjalan.

## 203 — Impor jadwal Excel: angka user DIIKUTI apa adanya (2026-08-01)

**Keluhan user** (membaca keterangan di form impor "Bobot tetap mengikuti RAB;
bentuk & jeda dari Excel dipertahankan"): *"jika user sudah upload jadwal
versinya, apakah kamu tidak bisa mengikuti angka dari dia apa adanya? ini upload
manual kamu harus mengikuti, kecuali orang tersebut meminta agar disesuaikan
dengan sistem dari inputan dia. jadi kalau user tidak minta, maka manual yang
jadi baselinenya."*

**Yang terjadi sebelumnya** (DECISIONS 103): impor Excel hanya meminjam
BENTUK-nya. Tiap kategori diskalakan ulang agar Σ mingguannya persis sama dengan
bobot RAB, dan kategori yang tidak ada di Excel diisi jadwal otomatis. Orang yang
menyusun 12% untuk satu pekerjaan lalu melihat 9,4% di sistem wajar menyimpulkan
uploadnya tidak dibaca — dan memang, yang dipakai cuma polanya.

### Keputusan

Impor Excel punya dua mode, **defaultnya `apaadanya`**:

- **`apaadanya` (default, tanpa dicentang)** — angka Excel dipakai sebagaimana
  adanya, TERMASUK bobot tiap pekerjaan. Pekerjaan yang tidak dijadwalkan di
  Excel dibiarkan kosong (tidak diisi otomatis). Selisihnya terhadap bobot RAB
  DISEBUTKAN di banner hasil impor — pilihan user berhak terlihat, bukan
  disamarkan.
- **`rab` (harus dicentang)** — perilaku lama: bentuk/jeda dari Excel
  dipertahankan, bobot direnormalisasi ke RAB, kategori tak-cocok diisi otomatis.

Modenya dicatat di `note` baseline dan payload audit `baseline.import`, supaya
pembaca angka itu nanti tahu bahwa perbedaan terhadap RAB adalah pilihan, bukan
bug.

### Batas yang tetap dijaga

Kurva-S wajib mulai 0, monoton naik, dan tuntas 100% (DECISIONS 052) — itu tidak
bisa dinegosiasi karena deviasi = realisasi − rencana, dan rencana yang berakhir
di 95% membuat deviasi akhir selamanya +5. Maka:

- Total Excel meleset **≤ 2 pp** dari 100 → diterima, seluruh sel dikalikan
  **satu faktor yang sama**. Perbandingan antar-pekerjaan, antar-minggu, dan
  setiap jeda tetap persis seperti di file; yang berubah hanya satuannya. Kalau
  faktornya bukan 1, itu **dikatakan** di banner.
- Meleset **> 2 pp** → **DITOLAK**, dengan menyebut totalnya dan pekerjaan RAB
  mana yang belum dijadwalkan. Selisih sebesar itu adalah kesalahan isi (baris
  terlewat, kategori belum diisi); menskalakannya diam-diam akan
  menyembunyikannya.
- Nilai **negatif ditolak** dengan menyebut baris & minggunya. Sebelumnya parser
  diam-diam mengubahnya jadi 0 — persis jenis perubahan-tanpa-memberi-tahu yang
  sedang diperbaiki di sini.

### Yang TIDAK terpengaruh

Kolom "Bobot Rencana" blanko KKP tetap memakai **bobot RAB × fraksi rencana
kategorinya** (`planFractionFromWeekly` — fraksi, bukan nilai absolut), lalu
diskalakan agar totalnya sama dengan rencana resmi kurva. Jadi jadwal "apa
adanya" mengubah BENTUK & BOBOT KURVA, bukan basis nilai per item di tabel KKP —
satu dokumen tetap tidak menampilkan dua angka untuk hal yang sama.

### Ikutan

`validateBaselinePoints` pindah dari `lib/baseline.ts` (server-only) ke
`lib/scurve/generate.ts` (murni) dan di-reexport, supaya sifat kurva bisa diuji
tanpa database. Logika "apa adanya" ada di `lib/scurve/jadwal-verbatim.ts` —
murni, tanpa db.

**Verifikasi**: 13 kasus unit baru (`jadwal-apa-adanya` — bobot = angka Excel
bukan RAB, sel & jeda diteruskan persis, kurva sah 10/40/80/100, selisih terhadap
RAB dilaporkan, skala seragam 99% → 100% mempertahankan rasio 10:60:30, batas
toleransi 2 pp, negatif & file kosong ditolak, pekerjaan tak terjadwal dibiarkan
kosong) · 9 kasus integrasi baru (`impor-jadwal-excel` — xlsx nyata → parser →
baseline tersimpan: bobot 10/60/30 vs RAB 5/70/25, kurva 10/40/80/100, jeda tetap
mendatar, banner menyebut selisih, note baseline, centang RAB mengembalikan
5/70/25, tolak total 70% & negatif tanpa membuat baseline, pembulatan kecil
diterima) · unit 706 ✓ · integrasi 229 ✓ · typecheck ✓ · lint ✓.

## 204 — Dua jalan buntu navigasi: kartu antrean & pindah lokasi (2026-08-01)

Dua keluhan user yang ternyata penyakit yang sama: layar menunjukkan sesuatu
perlu diurus, lalu tidak menyediakan jalan ke barangnya. Angka jadi
pemberitahuan, bukan pintu.

### A. "Perlu Koreksi: 1" tidak tahu laporan mana

**Keluhan**: *"diklik hanya ke halaman laporan, mana laporan yang dikembalikan,
mana yang perlu diperbaiki?"*

`executive-dashboard.tsx` menunjuk `/laporan` untuk kartu **Perlu Koreksi** DAN
**Menunggu Verifikasi**. Halaman itu berisi daftar lokasi + 20 laporan **final**
terakhir; laporan berstatus `perlu_koreksi`/`dikirim` tidak ada di sana sama
sekali. Datanya sebenarnya sudah ditampilkan di Command Center dan Hari Ini —
yang hilang hanya pintunya dari dashboard.

**Sekarang**: `/laporan/[antrean]` (`perlu-koreksi` | `menunggu-verifikasi`,
slug lain → 404). Tiap baris membuka laporannya langsung dan menyebut yang
dibutuhkan untuk bertindak:

- perlu-koreksi: **alasan pengembalian**, siapa yang mengembalikan + kapan,
  siapa pelapornya. Alasan yang kosong ditulis "tidak diisi oleh yang
  mengembalikan" — itu fakta berguna, bukan sesuatu yang disembunyikan:
  pelapor yang tak tahu apa yang salah membuat laporannya macet.
- menunggu-verifikasi: **lama menunggu**, urut yang paling lama di atas. Yang
  menumpuk 3 hari adalah masalah, yang masuk pagi tadi bukan — urutan
  tanggal kerja menyembunyikan bedanya. ≥3 hari ditandai merah.
- Lama menunggu dihitung per **hari kalender Jakarta**, bukan selisih jam:
  masuk kemarin jam 23 sudah "1 hari", karena itu yang dirasakan penunggunya.

`/laporan` sendiri mendapat dua pintu antrean di ATAS arsip — yang menunggu
tindakan lebih mendesak daripada yang sudah selesai. Hitungan 0 tetap
ditampilkan ("tidak ada yang menunggu"): kabar, bukan menu yang hilang.

### B. Pindah lokasi sepaket memutar lewat halaman paket

**Keluhan**: *"ketika masuk satu lokasi, kadang aku perlu pindah ke lokasi lain
di paket yang sama, hal ini terlalu banyak klik."*

Yang mahal bukan jumlah kliknya tapi **hilangnya konteks**: header → halaman
paket → cari lokasi → klik → mendarat di Ringkasan → cari tab lagi (4 klik).
Padahal pola kerjanya menyapu: memeriksa hal yang SAMA di beberapa lokasi.

**Sekarang**: nama lokasi di header workspace merangkap pemicu pemilih lokasi
(`location-switcher.tsx`) + panah ‹ › untuk sapuan berurutan. Satu klik.

- **Sub-halaman yang sedang dibuka IKUT TERBAWA** — dari `/lokasi/a/progress`
  memilih B berarti `/lokasi/b/progress`. Termasuk tanggal pada
  `/harian/[date]`: tanggal milik kalender, bukan milik lokasi, jadi
  membandingkan hari yang sama antar-lokasi justru itu yang dicari. Seluruh
  sub-halaman workspace ada di setiap lokasi, jadi tidak ada tautan jadi 404.
- Tab yang isinya belum tersedia di lokasi tujuan **tetap dibuka**; halamannya
  sendiri yang menjelaskan. Melempar diam-diam ke Ringkasan terasa seperti
  kliknya tidak berfungsi — orang akan mengklik dua kali dan makin bingung.
- Tiap baris membawa **status + deviasi**, supaya user memilih yang perlu
  dilihat, bukan membuka satu-satu untuk tahu. Lokasi tanpa baseline aktif
  ditulis "belum ada rencana", BUKAN 0% — 0% terbaca "tidak ada progres",
  padahal rencananya yang belum ada.
- **Urut ABJAD**, bukan deviasi terburuk di atas: posisi yang berpindah tiap
  hari membuat otot memori tak pernah terbentuk, dan "yang perlu perhatian"
  sudah punya tempatnya di dashboard.
- Hanya lokasi yang boleh diakses; sisanya **disebut jumlahnya** ("N lokasi
  lain tidak ditampilkan karena di luar penugasan Anda") — lanjutan aturan
  DECISIONS 200, "tidak muncul" tidak boleh terbaca "tidak ada".
- Kotak cari muncul otomatis bila > 7 lokasi — ambang yang sama dengan
  `Combobox` (`searchThreshold`), bukan angka baru.
- Satu lokasi saja → judul biasa. Kontrol yang tak punya tujuan tidak dipasang.

**Koreksi hari yang sama** (temuan user dari layar sungguhan): implementasi
pertama memberi tombol nama `border-transparent` — kotaknya baru muncul saat
di-hover — sementara panah ‹ › berkotak permanen. Hierarkinya jadi TERBALIK dari
rancangannya: kontrol utama tak terlihat sebagai kontrol, pelengkapnya paling
menonjol. Kontrol yang baru kelihatan setelah disentuh tidak akan pernah
ditemukan orang yang belum tahu fiturnya ada. Sekarang tombol nama berkotak
permanen dan panahnya yang ringan.

Nama lokasi tetap bisa diganti (DECISIONS 117): `EditableLocationName` menerima
`nameSlot`, jadi pemicu pemilih menggantikan judul saat tidak sedang diedit.

**Verifikasi**: 10 kasus integrasi baru (`navigasi-buntu` — alasan/pengembali/
pelapor terbawa, final tidak masuk antrean, scope tidak bocor, hitung hari
kalender Jakarta, urut abjad, deviasi null tanpa baseline, hiddenCount saat
sebagian/tanpa akses) · unit 706 ✓ · integrasi 239 ✓ · typecheck ✓ · lint ✓ ·
uji peramban nyata: dropdown terbuka dengan status+deviasi, memilih lokasi
mempertahankan `/progress`, panah ‹ berfungsi, `/harian/2026-07-20` membawa
tanggalnya, kedua halaman antrean tampil dengan data asli, slug antrean ngawur
→ 404.

## 205 — Penjadwal via GitHub Actions + tombol pengingat manual admin (2026-08-01)

Permintaan user: *"buat yang tadi untuk cron dari github, lalu buat juga satu
tombol untuk eksekusi pengingat semua orang, dari admin."*

### A. Workflow GitHub Actions

`.github/workflows/cron-harian.yml` — `POST /api/cron/harian` tiap hari 09:00
UTC (16:00 WIB) + `workflow_dispatch` untuk mencoba tanpa menunggu besok.
Konfigurasinya `vars.APP_URL` + `secrets.CRON_SECRET`; keduanya diperiksa lebih
dulu dan gagal dengan pesan yang bisa ditindaklanjuti, bukan 404 misterius.
Rahasianya hanya ada di header, tidak pernah ikut tercetak di log.

**Batasnya dikatakan di file itu, bukan disembunyikan**: scheduled workflow
GitHub berjalan di runner bersama (sering telat 5–20 menit) dan **dimatikan
diam-diam bila repo tidak menerima commit selama 60 hari**. Untuk pengingat sore
keterlambatannya tidak masalah; yang berbahaya adalah mati senyap, jadi kalau
proyek masuk mode pemeliharaan pemicunya harus pindah.

### B. Tombol manual di Sistem → tab "Pekerjaan Harian"

Penjadwal luar bisa mati, telat, atau belum dipasang; tanpa tombol ini
satu-satunya cara menagih lapangan adalah menunggu besok.

Tombolnya memanggil **fungsi yang sama persis** dengan cron, jadi hasil manual
dan terjadwal tidak mungkin berbeda — termasuk pengaman `UNIQUE (user, hari)`:
ditekan dua kali TIDAK mengirim pesan kedua, dan itu **dikatakan** ("N dilewati
karena sudah dikirim hari ini") supaya tidak terbaca sebagai gagal.

Karena ini mengirim WA ke HP orang lain dan tak bisa ditarik:
- **Daftar penerimanya ditampilkan LEBIH DULU** — nama, lokasi, dan apakah
  laporannya belum ada atau masih draf. Tombol yang mengirim pesan tanpa
  memberi tahu siapa penerimanya adalah jebakan, bukan kemudahan.
- Penanggung jawab **tanpa nomor WA disebut namanya**: "3 terkirim" tidak boleh
  terbaca "semua sudah tertagih".
- Dikunci `system.manage` + konfirmasi + tercatat di audit (`reminder.manual_send`).
- Tombolnya tidak dipasang saat tidak ada yang perlu dikirim — menekan tombol
  lalu tidak terjadi apa-apa terbaca seperti sistem rusak.
- Daftar kosong TIDAK diberi sebab karangan: bisa berarti semua sudah lapor,
  bisa juga belum ada lokasi berjalan yang SPMK-nya tiba.

`pratinjauPengingat` sengaja BUKAN di modul `"use server"` — tiap ekspor di sana
jadi endpoint yang bisa dipanggil siapa pun, dan daftar ini memuat nama orang.

### Dua bug yang ketahuan sambil mengerjakan ini

1. **`isWahaConfigured()` tidak pernah di-await** (`penjadwal.ts`, DECISIONS
   202). Fungsinya asinkron (baca konfigurasi dari DB), tapi ditulis
   `!isWahaConfigured()` — menegasikan Promise selalu `false`, jadi pengamannya
   TIDAK PERNAH aktif. Akibatnya saat WAHA mati: baris pengingat tetap ditulis,
   semua pengiriman gagal, dan karena `UNIQUE (user, hari)` percobaan yang benar
   berikutnya di hari itu ikut terlewat — WAHA mati sejenak = kehilangan
   pengingat sehari penuh. Lolos dari uji karena mock-nya SINKRON; mock-nya
   sekarang asinkron seperti aslinya, dan uji WAHA-mati kini memeriksa bahwa
   TIDAK ADA baris log yang ditulis.
2. **Pengiriman tidak ter-scope organisasi.** `kumpulkanPengingat` /
   `kirimPengingatHarian` kini menerima `orgId` opsional: cron sistem memanggil
   tanpa itu (semua tenant, memang tugasnya), tombol admin WAJIB mengisinya —
   admin organisasi A tidak boleh mengirim WA ke orang organisasi B
   (DECISIONS 150).

**Verifikasi**: 9 kasus integrasi baru (`pengingat-manual` — terkirim sungguhan,
tekan dua kali tidak dobel, tercatat di audit, 4 peran tanpa `system.manage`
ditolak, WAHA mati ditolak tanpa menghanguskan jatah hari itu, pratinjau
menyebut nama/lokasi/keadaan, tanpa-nomor disebut, orang pindah ke "sudah
dikirim" setelah terkirim, yang sudah lapor tidak ditagih) + `tugas-harian`
diperketat · unit 706 ✓ · integrasi 248 ✓ · typecheck ✓ · lint ✓ · panel dilihat
di peramban.

---

## 206 — "Terkirim 7" padahal nol sampai: status sesi WA wajib diperiksa (2026-08-02)

**Keputusan**: pengiriman pengingat WA hanya dilakukan bila sesi WAHA berstatus
`WORKING`. Status sesi itu ikut dilaporkan (`HasilHarian.pengingat.sesi`), dan
`sendText` mengembalikan ID pesan dari WAHA — bukan `void`.

**Sebab**: user menjalankan workflow cron dari GitHub, responsnya
`{"pengingat":{"terkirim":7,"gagal":0,"dilewati":0}}`, tapi **tidak satu pun
pesan sampai ke penerima**. Dua cacat menumpuk:

1. `sendText` bertipe `void`. Pemanggil hanya tahu "tidak melempar error", lalu
   menghitungnya sebagai "terkirim". WAHA menjawab **2xx untuk `sendText` walau
   sesinya belum login** (`SCAN_QR_CODE`/`STOPPED`/`FAILED`) — pesannya masuk
   antrean lalu hilang.
2. `kirimPengingatHarian` tidak pernah memeriksa `getSessionStatus()`. Selama
   URL + API key WAHA terisi, ia menembak terus.

Akibat gabungannya lebih buruk daripada sekadar salah angka: baris
`daily_reminder_logs` tetap ditulis dengan `status = sukses`, dan
`UNIQUE (user_id, date_key)` membuat percobaan yang BENAR di hari itu ikut
terkunci. Sesi WA mati semenit = pengingat sehari penuh hilang, sambil sistem
melaporkan sukses. Kegagalan senyap yang mengaku sukses adalah yang terburuk —
orang lapangan tidak ditagih, dan tidak ada yang tahu.

**Yang berubah**:
- Sesi dicek SEBELUM perulangan kirim. Bukan `WORKING` → keluar tanpa menulis
  satu pun baris log, jadi jatah hari itu utuh untuk percobaan setelah QR
  dipindai. Gagal mengecek (WAHA tak terjangkau) diperlakukan sama, dan
  pesan errornya ikut dilaporkan apa adanya.
- `HasilHarian.pengingat.sesi` — respons cron kini menyebutkan keadaan sesi
  (`WORKING`, `SCAN_QR_CODE`, `belum dikonfigurasi`, `tidak bisa dicek: …`).
  "terkirim: 7" tanpa keterangan ini tidak bisa dipercaya siapa pun.
- Kolom `daily_reminder_logs.wa_message_id` + migrasi idempoten
  `20260802000000_reminder_wa_message_id`. Diisi dari respons WAHA lewat
  `extractMessageId` (menangani bentuk `id` / `key.id` / `_id` /
  `{_serialized}` lintas versi engine). Tanpa id, "sukses" tak punya bukti
  yang bisa ditelusuri. Respons tanpa body → `null`, **tidak mengarang id**.
- Tombol admin menolak dengan **menyebut status sesinya**
  ("Sesi WhatsApp: SCAN_QR_CODE"), bukan "gagal" generik — perbedaannya adalah
  antara admin tahu harus memindai QR, dan admin menekan tombol berulang kali.
- Pratinjau di Sistem → Pekerjaan Harian memuat `sesiStatus`; bannernya muncul
  dan tombolnya disembunyikan saat sesi tidak hidup, jadi keadaannya terlihat
  SEBELUM ditekan.

**Yang TIDAK diubah**: `sendImage` dan pengiriman lain belum ikut memeriksa
sesi. Jalur pengingat harian yang dikeluhkan diperbaiki dulu; menyisir seluruh
pemakaian WAHA adalah pekerjaan tersendiri dan dicatat di `OPEN_ISSUES`.

**Verifikasi**: 2 kasus integrasi baru di `pengingat-manual` (sesi
`SCAN_QR_CODE` ditolak dengan namanya + tidak menulis log hari itu; pratinjau
melaporkan `FAILED`/`WORKING`) + 2 di `tugas-harian` (sesi mati = nol kirim nol
log; id pesan tersimpan) · mock `getSessionStatus` asinkron seperti aslinya ·
unit 707 ✓ · integrasi 252 ✓ · typecheck ✓ · lint ✓.

---

## 207 — Tombol admin tidak dikunci + dialog konfirmasi yang tidak pernah mengirim (2026-08-02)

Koreksi user atas DECISIONS 206, dan satu bug yang jauh lebih besar yang
ketahuan saat memverifikasinya di peramban.

### 1. Diagnosis 206 salah menuduh konfigurasi user

DECISIONS 206 menyimpulkan "sesi WhatsApp belum login" sebagai penyebab
`terkirim: 7` tanpa pesan sampai — **tanpa pernah memeriksanya**. WAHA sudah
dikonfigurasi sejak awal. Menyodorkan tebakan sebagai sebab, apalagi yang
menunjuk ke setelan user, lebih buruk daripada mengatakan "belum ketahuan".

### 2. Status sesi: keterangan, BUKAN pagar

206 memasang `getSessionStatus() === "WORKING"` sebagai syarat kirim. Itu
menjadikan satu bacaan kami sebagai penghenti pengiriman yang mungkin sehat —
nama status berbeda antar versi/engine WAHA, dan endpoint-nya bisa tak
terjangkau sesaat. Sekarang statusnya **dilaporkan** (`HasilPengingat.sesi`,
banner di panel) tetapi tidak pernah membatalkan pengiriman.

### 3. Admin tidak dikunci sekali sehari

Permintaan user: *"di halaman admin aku bebas kirim berapa kali pun … kamu
cukup mencegah atau menambah aksi ganda untuk kirim ulang, misal konfirmasi
kalau kirim ulang, bukan me-lock admin sama sekali."*

`kirimPengingatHarian(now, orgId, { paksa })` memisahkan dua pemanggil yang
kebutuhannya memang berbeda:
- **cron** (`paksa: false`) tetap sekali sehari per orang — penjadwal yang
  terpicu dua kali tidak boleh mengirim pesan kedua;
- **admin** (`paksa: true`) sebanyak yang ia mau. Yang dicegah adalah
  pengiriman TIDAK SENGAJA — daftar penerima (beserta nomor tujuannya) tampil
  lebih dulu, dan konfirmasinya menyebut berapa orang akan menerima pesan
  kedua. Pesan pertama yang tidak sampai adalah keadaan nyata; halaman yang
  menjawab "sudah dikirim hari ini" pada keadaan itu memutuskan sesuatu yang
  bukan haknya.

Pratinjau kini **tidak menyaring** yang sudah dikirimi hari ini: daftar "akan
menerima" harus persis sama dengan yang benar-benar dikirimi.

### 4. "Berhasil atau tidak" dijawab per orang

Keluhan user: *"apalagi saat ini gak jelas, ini berhasil atau tidak."*
`HasilPengingat.rincian[]` memuat nama, tujuan, ok, `waMessageId`, dan error
tiap penerima; panel menampilkannya setelah kirim. Nol terkirim dengan
kegagalan sekarang bernada MERAH — nada hijau di atas daftar yang semuanya
gagal adalah cara halaman berbohong. Terkirim tapi tak satu pun mengembalikan
ID pesan juga diangkat sebagai masalah, bukan disebut "sukses".

Kolom baru `daily_reminder_logs`: `chat_id`, `attempts`, `last_sent_at`
(migrasi idempoten `20260802010000_reminder_jejak_kirim`).

### 5. Nomor dinormalkan SAAT KIRIM, bukan cuma saat disimpan

`normalizeWaTarget` dulu hanya dipakai di form pengguna, sedangkan pengirim
memakai `waNumber` mentah. Baris lama/hasil impor bisa berisi `0812…`; WAHA
menerima bentuk itu dengan 2xx lalu **tidak mengirim apa pun**. Ini kandidat
penyebab nyata "terkirim tapi tidak sampai" — dan sebelumnya tak terlihat
karena mock uji memakai nomor polos. Nomor tujuan kini ikut ditampilkan di
pratinjau dan disimpan di log.

### 6. BUG BESAR: setiap dialog konfirmasi di aplikasi ini tidak mengirim apa pun

Ditemukan saat menekan tombolnya sungguhan di peramban. `ConfirmSubmit`
menutup dialog di dalam `onClick` tombol "Ya" yang bertipe `submit`. React
mem-flush update state **sinkron** begitu handler selesai — SEBELUM peramban
menjalankan aksi bawaan tombol — sehingga tombolnya sudah lepas dari DOM saat
form seharusnya dikirim. Hasilnya: dialog menutup, tidak ada request, tidak
ada apa pun. Terlihat berhasil.

Terkena SEMUA pemakaian `ConfirmSubmit`: setujui/tolak termin keuangan
(`approval-queue`, `lokasi-keuangan-client`), kelola dokumen (`manage-forms`),
dan tombol pengingat ini. Perbaikannya: form dikirim sendiri lewat
`requestSubmit()` di dalam handler, jadi urutan penutupan dialog tidak lagi
menentukan.

Tidak bisa dijaga uji unit/integrasi — kegagalannya ada di urutan antara React
dan peramban. Karena itu dijaga uji E2E `tests/e2e/konfirmasi.spec.ts`, yang
sudah dibuktikan GAGAL pada kode lama dan LULUS pada kode baru.

**Pelajaran yang lebih penting dari bug-nya**: 206 diverifikasi dengan uji
otomatis dan typecheck saja. Uji-uji itu memanggil server action langsung —
jadi seluruh lapisan tombol→dialog→form tidak pernah dilewati sekali pun.
Fitur yang menyentuh UI harus ditekan tombolnya di peramban sebelum disebut
selesai.

**Verifikasi**: integrasi 257 ✓ (termasuk kasus baru: paksa mengirim ulang +
menghitung percobaan, rincian per penerima, nomor lama dinormalkan saat kirim,
status sesi tidak membatalkan) · unit 708 ✓ · E2E 9 ✓ (desktop) · typecheck ✓ ·
lint ✓ · panel dilihat dan tombolnya ditekan di peramban.

---

## 208 — Kode RAB dari negosiasi resmi dipakai apa adanya; ekspor bisa diimpor ulang (2026-08-02)

Laporan user 2026-08-02 dengan RAB Sugihwaras di tangan:

> 1. penomoran tidak sync, padahal jelas di sistem itu adalah hasil dari
>    negoisasi resmi, di sistem III di kamu II. pikirkan bagaimana seharusnya
> 2. hasil exportmu jika diimport ulang tidak bisa, karena parser tidak
>    mengenali strukturnya

Keduanya berakar pada SATU keputusan yang salah di ekspor.

### Sebab: ekspor menomori ulang kategori — separuh saja

`rab-xlsx.ts` menomori ulang kategori berurutan (`toRoman(i + 1)`) dengan alasan
"file sumber kerap memuat roman ganda/loncat". Alasan itu keliru:

- **Loncatnya kode bukan kesalahan.** RAB aktif adalah hasil negosiasi RESMI;
  nomor bangunan di sana dirujuk kontrak, adendum, berita acara, dan laporan
  KKP. Menomori ulang membuat dokumen ekspor tak bisa dicocokkan dengan berkas
  resmi mana pun — diam-diam, tanpa satu kata pun di dokumennya.
- **Penomoran ulangnya bahkan tidak konsisten.** Hanya baris kategori yang
  diubah; anak-anaknya tetap membawa kode asli. Hasilnya berkas yang
  bertentangan dengan dirinya sendiri: kategori "II PEKERJAAN TAMBATAN PERAHU"
  berisi anak "III.1", dan baris rekapnya berbunyi "JUMLAH II".

Itu pula sebab keluhan kedua. Saat berkas diimpor ulang, parser melihat sub-kode
`III.1` di bawah kategori `II`, lalu — sesuai aturan yang memang benar untuk RAB
tanpa judul kategori — membuka KATEGORI HANTU "PEKERJAAN (kategori III — judul
tidak ada di file)". Diukur pada berkas ekspor nyata user: **29 kategori** (dari
17), 24 peringatan, dan separuh kategori bertotal 0.

**Keputusan**: kode kategori dipakai apa adanya dari DB (`displayCode`), sama
seperti kode anak. Yang tetap dibuang hanya suffix dedup internal (`VI#2` → `VI`)
karena itu artefak teknis lineage, bukan kode dokumen. Kategori yang benar-benar
tidak punya kode diberi penanda posisi `(1)`, `(2)` — satu-satunya kode yang kami
karang, dan hanya saat tidak ada yang bisa dipakai. Sejalan dengan DECISIONS 203.

Diverifikasi pada berkas ekspor NYATA user (bukan cuma data buatan): dengan kode
kategori dikembalikan ke aslinya, parse menghasilkan **17 kategori, 0 peringatan,
tanpa kategori hantu**.

### Sebab kedua: parser tak mengenali kode yang ia susun sendiri

File HPS asli menulis rincian terdalam dengan kode PENDEK (`a`, `b`) atau kosong;
parser-lah yang menyusun kode lengkapnya (`${induk}.${huruf}`) sebelum masuk DB.
Ekspor menulis kembali kode lengkap itu — dan parser tidak mengenalinya:
`6.1.a`, `6.7.1` jatuh ke `other` lalu **hilang beserta volume, satuan, dan
harga satuannya**. Totalnya tetap terlihat benar karena diambil dari baris grup,
jadi kehilangannya tidak kelihatan dari angka mana pun. Itu yang paling
berbahaya.

`DEEPCODE` (`^\d+(?:\.\d+)*\.(?:[a-z]|\d+)$`) kini dikenali; induknya dicari
dari PREFIX kode lewat peta `byCode` per kategori, jadi tidak bergantung pada
tebakan urutan baris.

### Yang BELUM terjawab — angka ekspor ≠ angka layar

Berkas ekspor user konsisten ke dalam (Σ kategori = JUMLAH = Σ daun tiap
kategori = **5.891.116.482**), tetapi layar menunjukkan **5.891.112.777** —
selisih Rp 3.705, tersebar di 8 dari 17 kategori (mis. KIOS PERBEKALAN
172.985.194 vs 172.982.810). Berkasnya menyebut "RAB revisi aktif #1".

Ini TIDAK diperbaiki di sini karena penyebabnya belum diketahui: bisa berarti
ekspornya diambil dari revisi yang berbeda dengan yang sekarang tampil, bisa
juga agregat layar dan agregat tersimpan memang berbeda. Menebak salah satunya
lalu "membetulkan" angka adalah persis yang dilarang CALCULATION_INTEGRITY.
Dicatat di `docs/OPEN_ISSUES.md`, menunggu keterangan revisi mana yang diekspor.

**Verifikasi**: 11 kasus unit baru (`rab-ekspor-impor-ulang`) — kode asli di
ketiga sheet termasuk yang loncat, kode induk & anak tidak bertentangan, tanpa
kategori hantu, nilai & volume & satuan & harga satuan utuh, subkategori tetap
subkategori, rincian `6.1.a` tidak hilang, kode berjenjang menempel ke induknya,
baris rekap tidak jadi pekerjaan · uji ekspor lama disesuaikan ke keputusan baru
· unit 719 ✓ · integrasi 257 ✓ · typecheck ✓ · lint ✓ · dijalankan juga pada
berkas ekspor nyata user.

---

## 209 — Impor Excel ke DRAFT adendum, dengan diff sebelum disimpan (2026-08-02)

Laporan user 2026-08-02:

> saat ini kalau aku membuat draft adendum, harusnya ada import yang bisa
> digunakan juga di situ, tapi ini tidak ada, sementara draft sudah terlanjur
> dibuat. sementara jika aku memakai jalur importmu yang sekarang itu langsung
> dibuat rab aktif dan dianggap adendum, ini tidak pas.

Benar. `importHps` selalu memanggil `activateRevision` tepat setelah membuat
revisi — jadi SATU-SATUNYA jalur impor Excel selalu mengganti RAB aktif,
me-regenerate kurva-S, dan menggeser dasar keuangan. Adendum yang baru
*diajukan* terpaksa diperlakukan seolah sudah sah. Editor draft yang sudah ada
(DECISIONS 118) hanya bisa diisi baris demi baris dari layar, padahal dokumen
adendum datang sebagai Excel.

**Keputusan**: impor punya TUJUAN yang dipilih user (`ImportMode`):

- `draft` — isi DRAFT adendum. RAB aktif, progres, kurva-S, dan keuangan tidak
  tersentuh sama sekali; tidak ada `activateRevision`, tidak ada
  `regenerateBaseline`. Draft baru berlaku setelah diaktifkan lewat halaman
  Adendum seperti biasa.
- `aktifkan` — perilaku lama, untuk HPS awal dan adendum yang SUDAH resmi.

Draft yang sudah ada **diganti seluruhnya** (pilihan user; "gabungkan" ditolak
karena mudah menyisakan item hantu yang tidak ada di dokumen adendum). Kaitan
ke adendum kontrak (`amendmentId`) dan catatan draft lama DIBAWA IKUT — kalau
tidak, tautan resmi ke CCO hilang diam-diam saat file di-impor ulang.

Formnya sekarang muncul juga di halaman Adendum, jadi draft yang "terlanjur
dibuat" tinggal diisi — tidak perlu dibuang dulu.

### Diff ditampilkan SEBELUM ada yang ditulis

`bandingkanTerhadapAktif` (murni, tanpa DB) membandingkan hasil parse dengan
RAB aktif memakai **lineageKey** — identitas yang sama dengan yang dipakai
laporan harian, bukan nama. Yang ditonjolkan adalah dua keadaan yang merugikan
orang kalau baru ketahuan setelah disimpan:

1. **Item yang SUDAH dikerjakan tapi tidak ada di file baru.** Realisasinya
   lepas dari RAB dan progres lokasi turun tanpa sebab yang kelihatan. Disebut
   namanya, diurutkan yang ber-realisasi lebih dulu.
2. **Volume kontrak turun DI BAWAH volume yang sudah dikerjakan.** Ada
   pekerjaan yang tidak punya dasar bayar. Ditandai — TIDAK dibetulkan sendiri.

Selisih nilai total ditampilkan apa adanya (aktif → baru, beserta arahnya).

**Verifikasi**: 7 kasus unit baru (`rab-diff-pratinjau`) · typecheck ✓ · lint ✓
· unit 726 ✓ · integrasi 257 ✓.

### Yang BELUM dikerjakan dari permintaan hari ini

- **Laporan progres atas draft adendum** (permintaan user poin 6): flag per
  baris laporan "terhadap RAB aktif" atau "terhadap draft adendum", plus
  laporan berbasis draft. Sudah disepakati bentuknya, belum dibangun.
- **Subtotal dokumen dipakai apa adanya** (poin 3): user memilih menyimpan
  subtotal kategori dari file nego dan menampilkannya apa adanya, dengan
  selisih terhadap Σ item DISEBUT, bukan ditambal. Ini membatalkan sebagian
  prinsip "agregat selalu derived" (CLAUDE.md #4) dan perlu keputusan
  tersendiri saat dikerjakan.

---

## 210 — Progres atas draft adendum: satu laporan, dua basis (2026-08-02)

Permintaan user 2026-08-02:

> dalam realita di lapangan, seringkali pekerjaan itu dikerjakan dulu baru
> adendumnya dibuat … jadi kita bisa buat rab posisi draft tapi progress atas
> draft itu tetap bisa dibuat laporannya

Sebelum ini hanya ada dua pilihan, dua-duanya buruk:
- **tolak laporannya** — pekerjaan nyata di lapangan tidak tercatat sama
  sekali, dan mandor belajar bahwa sistem ini tidak mewakili kenyataan; atau
- **aktifkan adendum yang belum sah** — progres resmi, kurva-S, dan dasar
  termin bergerak atas pekerjaan yang belum punya dasar kontrak.

**Keputusan** (bentuknya dipilih user): laporan tetap SATU, tiap baris diberi
penanda basisnya — `DailyReportItem.basis`:

- `aktif` — dilaporkan terhadap RAB kontrak yang berlaku;
- `draft_adendum` — dilaporkan terhadap RAB pengajuan adendum yang belum resmi.

User: *"sebenarnya tidak perlu terpisah penuh juga, kan ada item yang sama
antara rab aktif dan draft rab, kamu hanya perlu flag laporan progress terhadap
rab aktif atau terhadap draft adendum."* Tepat — dan itu juga menghindari
mandor mengisi dua kali (foto & volume dobel = risiko besar di lapangan).

### Angka resmi TIDAK boleh bergerak

Ini bagian yang paling mudah rusak diam-diam, jadi dijaga di tiga tempat:

1. SQL `getLocationsProgress` menyaring `dri.basis = 'aktif'`. Tanpa itu, item
   yang lineage-nya ada di RAB aktif MAUPUN draft akan ikut terhitung dan
   progres resmi naik tanpa dasar.
2. `cumulativeVolumeByLineage` default hanya basis aktif — jadi guard volume,
   sisa RAB di form, dan blanko KKP ikut aman tanpa perubahan apa pun di
   pemanggilnya.
3. Uji integrasi `laporan-basis-adendum` menegakkan: setelah laporan berbasis
   draft DIKIRIM, `realizedValue` resmi tetap 0.

### Batas volume tetap ditegakkan, hanya bedanya acuan

- Basis **aktif** → dibandingkan dengan volume RAB aktif, menghitung realisasi
  basis aktif saja.
- Basis **draft** → dibandingkan dengan volume RAB draft, menghitung realisasi
  KEDUA basis. Volume draft adalah volume kontrak *seandainya* adendum
  disetujui; pekerjaan yang sudah dilaporkan lewat basis aktif sudah termasuk
  di dalamnya. Kalau hanya basis draft yang dihitung, volume total bisa
  terlampaui diam-diam.

Item dari revisi `digantikan` tetap ditolak — itu masa lalu, bukan pengajuan.

### Yang dilihat orang

- **Daftar pilihan item** memuat item draft yang belum ada di RAB aktif,
  bertanda "Pengajuan adendum — belum resmi". Item yang lineage-nya masih ada
  di RAB aktif TIDAK digandakan: yang muncul versi aktifnya, supaya pekerjaan
  yang sah tidak malah tercatat di luar angka resmi.
- Setelah item draft dipilih, pelapor diberi tahu dampaknya sebelum menyimpan.
- **Halaman Progress** memuat kartu "Progres seandainya adendum disetujui" bila
  lokasinya punya draft: nilai RAB draft, terpasang menurut draft, dan
  terpasang menurut RAB resmi sebagai pembanding — supaya tidak ada yang
  mengira angka draft menggantikan angka kontrak.

**Verifikasi**: 9 kasus integrasi baru (`laporan-basis-adendum`) — item khusus
draft bisa dilaporkan dan bertanda, volume di atas batas RAB aktif bisa lewat
jalur draft, progres resmi TIDAK naik walau laporan sudah dikirim, kumulatif
default hanya basis aktif, angka draft dihitung memakai RAB draft mencakup dua
basis, lokasi tanpa draft → null (bukan nol yang menyesatkan), revisi
digantikan ditolak, batas volume ditegakkan di kedua jalur · typecheck ✓ ·
lint ✓ · unit 727 ✓ · integrasi 266 ✓.

**Belum**: laporan periodik/KKP belum punya varian "termasuk pengajuan
adendum"; yang ada baru ringkasan di halaman Progress.

---

## 211 — Angka resmi disaring basis aktif di SEMUA jalurnya, bukan hanya progres (2026-08-02)

**Permintaan user**: "blanko kkp dan laporan resmi jangan diapa-apakan dulu,
laporan resmi tetap harus berdasar rab aktif."

DECISIONS 210 menutup tiga tempat (SQL `getLocationsProgress`,
`cumulativeVolumeByLineage`, uji integrasi). Penyisiran seluruh pembaca
`DailyReportItem` menemukan empat jalur yang MASIH bocor:

| Jalur | Akibat sebelum ditambal |
| --- | --- |
| `baseline.getScurveSeries` | kurva-S realisasi naik atas laporan basis draft |
| `periodic-report` | bobot realisasi laporan mingguan/bulanan KKP ikut naik |
| `ai-hub/source` deteksi overrun | temuan palsu "volume melebihi RAB" |
| halaman RAB (realisasi mingguan) | realisasi ≠ basis target rencananya |

Ketiga yang pertama menyaring lineage ke revisi aktif, dan itulah yang membuat
kebocorannya tidak kelihatan: item yang **volumenya diubah adendum ada di kedua
revisi**, jadi ia lolos filter lineage. Yang hanya-ada-di-draft memang
tersaring; yang berbahaya justru yang beririsan.

Guard volume saat `→ dikirim` (`assertVolumeWithinRab`) juga diperbaiki: dulu
menjumlahkan semua basis untuk setiap baris, sehingga baris basis AKTIF yang
sah bisa ditolak gara-gara ada laporan basis draft. Sekarang dikelompokkan per
basis, sepadan dengan guard di `upsertItem`.

**Tidak diubah**: blanko KKP dan laporan periodik tetap murni RAB aktif — tidak
diberi varian "termasuk pengajuan adendum". Angka draft hanya hidup di kartu
halaman Progress.

**Verifikasi**: 2 kasus integrasi baru — kurva-S realisasi tetap 0% walau
laporan basis draft atas lineage yang beririsan sudah dikirim, lalu bergerak
tepat 40% begitu dilaporkan lewat basis aktif · typecheck ✓ · lint ✓ · unit 728 ✓.

---

## 212 — Ekspor Excel RAB: Jumlah item angka mati, bukan ROUND(volume×harga) (2026-08-02)

**Laporan user**: "unduh excelmu masih bermasalah, hasil import di layar sudah
sesuai di excel … apakah perbedaan ini karena di database kamu menggunakan
harga satuan x volume?"

Ya — dan hanya di ekspor. Berkas unduhan menulis daun sebagai rumus
`ROUND(volume×harga,0)`; `result`-nya memang angka DB, tapi begitu Excel
merekalkulasi ia menghitung ulang dari **harga satuan yang sudah dibulatkan 2
desimal di dokumen sumber**, sementara Jumlah di dokumen berasal dari analisa
harga satuan yang presisinya lebih panjang. Keduanya tidak sama.

Diukur pada RAB Wonorejo Situbondo rev.1 yang diunggah user:

- 152 dari 1.227 baris item meleset Rp1–Rp4;
- 118 baris agregat ikut bergeser;
- nilai pra-PPN 5.891.112.785 → **5.891.116.482** (+Rp3.697) — lalu PPN dan
  TOTAL dihitung di atas angka yang sudah melenceng.

**Keputusan**: Jumlah item ditulis sebagai angka tersimpan (angka mati). Baris
induk tetap berumus `F<anak>+F<anak>` karena subtotal tersimpan memang PERSIS Σ
anak tersimpan — diperiksa atas 218 baris agregat berkas itu, nol selisih —
sehingga rekalkulasi Excel mendarat tepat di angka dokumen. Kolom volume dan
harga satuan tetap ditampilkan apa adanya; bahwa vol×harga ≠ Jumlah adalah
sifat dokumen sumbernya, dan menutupinya berarti mengarang presisi yang tidak
kita punya (DECISIONS 203).

**Catatan cakupan**: perhitungan di belakang layar TIDAK terpengaruh — progres,
bobot, kurva-S, dan keuangan semuanya memakai `RabNode.amount` (angka dokumen),
bukan volume×harga. `DailyReportItem.valueDone` memang disimpan dengan
round(volume×harga) tapi tidak dibaca satu pun laporan (diverifikasi dengan
penyisiran: satu-satunya pembaca adalah Prisma Client hasil generate).

**Verifikasi**: uji unit baru memakai angka nyata dari RAB Wonorejo
(4852,122 × 8.465,19 → dokumen 41.074.131, hasil kali 41.074.135) — ekspor
wajib menulis 41.074.131 · unit 728 ✓ · typecheck ✓ · lint ✓.
