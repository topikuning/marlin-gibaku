# PROJECT.md — MARLIN

Single source of truth arsitektur & keputusan produk. Versi rebuild total
2026-07-14 (DECISIONS 051). Konflik kode vs dokumen ini ⇒ kode yang salah.
Detail teknis per topik: `docs/rebuild/*.md`.

## 1. Produk

Sistem pengendalian proyek KNMP (83 lokasi, 7 provinsi; owner program = KKP;
PT pengendali program dgn vendor pelaksana). Tujuan: satu input harian di lapangan
→ semua laporan (internal + format KKP) + progress + keuangan turun dari data yang
sama, tertelusur, dan diaudit.

Prinsip produk: alur mengikuti pekerjaan nyata (bukan tabel DB); exception-first
(dashboard = apa yang harus dikerjakan); tidak ada input ganda; semua angka bisa
diklik sampai data pembentuknya; mobile lapangan ringan; desktop manajemen padat.

## 2. Lifecycle (canonical)

- **PackageStage** (disimpan + histori append-only; transisi eksplisit oleh user;
  dokumen = bukti, bukan pemicu otomatis):
  `prospek → tender → penetapan → kontrak → pelaksanaan → serah_terima → selesai`
  (+ `batal` dengan alasan).
- **LocationStatus** (fisik, orthogonal):
  `persiapan → berjalan ⇄ terhenti → selesai → pho → pemeliharaan → fho` (+ `batal`).
- **DailyReport**: `draft → dikirim → (perlu_koreksi → dikirim)* → disetujui → final`.
  Koreksi mengedit report yang sama (tidak ada duplikat); `reportDate` = tanggal kerja.
- **AdminMilestone**: `belum_dimulai / berjalan / menunggu_pihak_lain / perlu_perbaikan /
  selesai / tidak_berlaku` (+ derived `terlambat`). Milestone `requiresVerification`
  tidak bisa selesai hanya karena upload dokumen.
- **Transaksi keuangan**: `draft/diajukan → disetujui|ditolak → (dibayar_sebagian → lunas)`.
- Mesin transisi: `src/lib/lifecycle.ts` — satu-satunya tempat aturan transisi + label + tone.

## 3. Domain model (ringkas — detail docs/rebuild/DOMAIN_MODEL.md)

```
Organization → Package (spine) → Contract (0..1, uniq per paket; ppnPercent di kontrak)
                              → ContractAmendment (append-only)
                              → Location (1..N; multi-lokasi per kontrak didukung)
Location → RabRevision (draft|aktif|digantikan) → RabNode (pohon 1 tabel;
           lineageKey path stabil utk carry-over realisasi lintas revisi)
         → Baseline (+BaselinePoint) versioned (auto smoothstep per-trade / manual / adendum)
         → WeeklyPlan advisory
         → DailyReport (uniq lokasi+tanggal) → Item (uniq report+lineage) +
           Worker/Material/Equipment + StatusHistory (append-only) + Photo (sha256 dedup)
         → Issue → RecoveryAction → RecoveryUpdate
         → BudgetLine / Commitment / Expense / Invoice+PaymentOut  (keuangan lokasi)
Contract → OwnerBilling (termin) → Disbursement                    (penagihan owner)
Package/Location → AdminMilestone (template KKP 45 item) → Document (FK nyata ke semua
           entitas; version chain supersedesId; append-only by convention)
Sistem  → AuditLog (append-only, ditulis semua mutasi) · Alert · AppSetting effective-dated
Akses   → User (mustChangePassword, tokenVersion) · Session (DB, revocable) ·
           LoginAttempt (rate limit) · LocationAssignment (scope)
```

Aturan angka: uang BigInt rupiah; agregat SELALU derived; snapshot hanya
`DailyReport.finalSnapshot` (immutable saat final).

**Calculation layer tunggal** (DECISIONS 151/152 — dilarang menulis ulang
formula ini di modul, komponen, PDF, Excel, atau prompt AI mana pun):

| Modul | Isi |
|---|---|
| `src/lib/progress-calc.ts` | MURNI: `prestasiPct`, `itemAchievement`, `realizedPctFromItems`, `bobotPct` |
| `src/lib/progress.ts` | akses DB: `grandTotal`, `realized`, `planPct`, `deviationPct`, `COUNTED_REPORT_STATUSES` |
| `src/lib/finance/calc.ts` | agregat keuangan |

Formula kanonik:

```
grandTotal    = Σ amount node kategori revisi AKTIF
bobot item    = amount item / grandTotal × 100
prestasi s/d  = volKontrak > 0 ? min(100, volSd / volKontrak × 100) : 0
prestasi ini  = prestasi s/d − prestasi lalu        ← DITURUNKAN (kolom wajib berjumlah)
bobot realisasi = prestasi / 100 × bobot
realized      = Σ bobot realisasi (BUKAN Σ valueDone — lihat DECISIONS 151)
deviationPct  = realizedPct − planPct
valueDone     = round(volume × hargaSatuan)          ← nilai TERSIMPAN per laporan, bukan basis agregat
```

Level status yang dihitung: `COUNTED_REPORT_STATUSES` = dikirim + disetujui +
final (satu level; belum dipisah dilaporkan/terverifikasi/final — lihat
docs/OPEN_ISSUES.md). Kurva-S: smoothstep per fase kategori + penjadwalan
per-trade. PPN: RAB pre-PPN vs kontrak incl-PPN, warning selisih >0.1%.

Invarian yang dijaga uji (`tests/integration/periodic-report.test.ts`): kolom
laporan berjumlah, "s/d" tidak pernah mundur antar periode, Σ bobot = 100,
dashboard = kurva ringkasan lokasi = blanko KKP, lineage mati tidak ikut,
draft tidak dihitung, grandTotal 0 tidak menghasilkan NaN, lokasi tidak
tercampur.

## 4. Permission

Capability-based (`src/lib/authz.ts`, matrix di docs/rebuild/PERMISSION_MATRIX.md).
7 role: super_admin, program_director, regional_manager (Area Manager),
project_manager, site_manager, field_supervisor (Mandor), exec_viewer.
Cross-location: super_admin, program_director, exec_viewer; lainnya via
LocationAssignment. Backend selalu re-check (`requireCapability` +
`requireLocationAccess`); middleware hanya redirect login. Session DB revocable;
rate limit login; wajib ganti password first-login; audit log tiap mutasi.
RLS TIDAK diklaim (lihat OPEN_ISSUES).

## 5. Informasi arsitektur

Lihat docs/rebuild/TARGET_INFORMATION_ARCHITECTURE.md. Menu: Beranda (Command
Center exception-first) · Paket (workspace tab: Ringkasan/Tender/Kontrak &
Adendum/Lokasi/Dokumen/Aktivitas) · Lokasi (workspace tab: Ringkasan/Rencana &
RAB/Pelaksanaan Harian/Progress/Keuangan/Dokumen & Kepatuhan/Laporan) ·
Hari Ini (landing lapangan mobile) · Progress · Keuangan · Dokumen · Laporan ·
Pengguna · Sistem. Cetak KKP di `/cetak/*` tanpa shell. Mobile bottom-nav ≤5
tujuan per role.

## 5a. AI Intelligence Hub (DECISIONS 133)

Menu global `/ai` (capability `ai.*`; field_supervisor tanpa akses): Portfolio
Pulse (KPI + tabel exception-first + readiness gate — deterministik penuh,
berfungsi tanpa provider AI), Perlu Tindakan (antrean rule risiko; simpan =
draft saran, TIDAK menulis Issue/Recovery), Report Studio (7 template; satu
structuredContent → pratinjau/cetak-A4/WA/Excel dgn angka identik; lifecycle
draft→direview→disetujui→beku→terkirim via lifecycle.ts; beku immutable),
Ask MARLIN (grounded, read-only, bersitasi, percakapan tersimpan), Riwayat &
Audit (usage token/latency/estimasi biaya per run). Prinsip: **AI bukan sumber
angka** — semua angka dari calc layer; output AI lolos zod + validasi scope +
sourceRef + klaim angka, bagian gagal dibuang jadi limitation. In-process (tanpa
service/Redis/MCP/agent framework); guard AppSetting: kill switch + rate limit +
batas ukuran; API key provider terenkripsi AES-256-GCM (`AI_SECRET_ENCRYPTION_KEY`).

## 6. Alur harian (jantung sistem)

Mandor/SM buka **Hari Ini** → workspace tanggal `/lokasi/[slug]/harian/[date]` →
pilih item RAB (sisa volume tampil) → isi volume + foto (kompresi + EXIF + stamp,
dedup sha256) + kendala → kirim. SM verifikasi di layar yang sama: kembalikan
(alasan wajib) atau lengkapi KKP (tenaga/material/alat/cuaca/jam) → setujui →
final (snapshot) → cetak KKP harian. Integritas: uniq(lokasi,tanggal) +
uniq(report,lineage) di DB; kumulatif ≤ volume RAB; revisi tidak dihitung dobel;
draft volume tersimpan lokal (localStorage) sampai submit sukses.

## 7. Keuangan

Transaction-based; agregat derived: availableBudget = budget − realisasi −
komitmen-belum-realisasi; outstanding = invoice disetujui − pembayaran;
unbilled = terpasang terverifikasi − tertagih; cashRequirement = komitmen jatuh
tempo + forecast − kas − pencairan terjadwal. Approval flow di semua transaksi;
`finance.approve` terpisah dari input dan dari `user.manage`.

## 8. Deployment

Railway, builder DOCKERFILE (Nixpacks dilarang). Node 24 pinned, image
bookworm-slim, non-root, tini, standalone Next, preDeploy `prisma migrate deploy`,
healthcheck `/api/health` (DB; R2 bukan hard-dep). Env divalidasi zod saat startup;
endpoint R2 dinormalisasi (tolak r2.dev/protokol ganda/path). CI wajib hijau
sebelum merge. Reset DB hanya APP_ENV development/test dgn guard ganda.

## 9. Testing

docs/rebuild/TEST_PLAN.md. Unit (formula, parser, authz, env, lifecycle),
integration (constraint DB, transaksi, append-only), E2E kritis (auth+role,
prospek→kontrak, RAB import, siklus laporan+koreksi, keuangan, kepatuhan).
Definition of Done = prompt rebuild §38 + traceability matrix terisi.

## 10. Scope yang sengaja ditunda

Peta Leaflet, PWA offline penuh, PR/PO/receiving granular, intake WA-text —
tercatat di OPEN_ISSUES + REBUILD_PLAN dgn alasan.
