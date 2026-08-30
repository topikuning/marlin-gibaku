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
- **Document**: `aktif → dibatalkan → (pulihkan) aktif`; hapus permanen (super_admin)
  hanya dari `dibatalkan`. Dokumen `dibatalkan` hilang dari daftar & TIDAK dihitung
  sebagai bukti milestone; bila tak ada bukti aktif lain, milestone yang selesai
  karenanya dikembalikan — kecuali sudah diverifikasi manusia (DECISIONS 183).
  Nama tampilan dokumen DITURUNKAN dari data (`src/lib/document-label.ts`), bukan
  dari judul yang diketik. Asal berkas: `unggahan` atau `drive_kkp` (impor dari
  folder Drive KKP, isi disalin ke R2 — DECISIONS 184).
- **Transaksi keuangan**: `draft/diajukan → disetujui|ditolak → (dibayar_sebagian → lunas)`.
- **Finding (temuan pemeriksa, DECISIONS 426)**: `baru → menunggu_klarifikasi →
  ditindaklanjuti → menunggu_verifikasi → selesai → dibuka_kembali`. Temuan ≠
  kendala (`Issue`): hanya verifikator (`finding.verify`) yang menutup/membuka
  kembali; pihak pelaksana menindaklanjuti (`finding.respond`).
- **Inspection**: `draft → final` (draft hanya bisa diubah pemeriksanya sendiri).
- **Verifikasi eksternal laporan harian** (`ReportVerification`): BUKAN state
  machine tersimpan — append-only, baris terakhir per laporan = keadaan
  (`diverifikasi/perlu_klarifikasi/ditolak`); TIDAK menyentuh status laporan
  maupun angka resmi.
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
         → Finding (temuan pemeriksa, DECISIONS 426) → FindingStatusHistory
           (append-only) + FindingClarification + FindingNote + EvidenceLink
           (bukti = TAUTAN ke Photo/Document existing, XOR + wajib induk via
            CHECK constraint; verifikasi bukti per-tautan)
         → Inspection (inspeksi Wakil PPK, draft→final) → Finding/EvidenceLink
         → DailyReport → ReportVerification (verifikasi eksternal, append-only —
           jejak pemeriksaan pemberi kerja, TIDAK menggerakkan angka)
         → Issue → RecoveryAction → RecoveryUpdate
           (Issue = SATU-satunya bentuk kendala yang bisa ditagih: punya
            source/PIC/tenggat/penutup, papan lintas lokasi di `/kendala`,
            penagih WA lewat cron harian — DECISIONS 392. Kendala di
            FieldActivity naik jadi Issue saat kegiatan difinalkan.)
         → BudgetLine / Commitment / Expense / Invoice+PaymentOut  (keuangan lokasi)
Contract → OwnerBilling (termin) → Disbursement                    (penagihan owner)
Package/Location → AdminMilestone (template KKP 45 item) → Document (FK nyata ke semua
           entitas; version chain supersedesId; append-only by convention)
AHSP    → AhspSource (SE DJBK 47/2026 terbitan 5.0-universal, sha256 + matchingEngine)
           → AhspEntry (+aliases/keywords/legacyId dari berkas) → AhspComponent
           (kategori APA ADANYA dari berkas: upah|bahan|alat|fasilitas|…)
           (koefisien upah/bahan/alat) · AhspPadanan (kunci GLOBAL = tanda uraian+satuan;
           pemetaan item RAB → analisa; `otomatis` = usulan mesin, `disetujui`/`koreksi`
           = keputusan manusia — HANYA yang terakhir dipakai menghitung RAPL)
Location → HargaSatuanDasar (HSD per lokasi; kunci kategori+nama+satuan sama persis
           dengan kunci kebutuhan RAPL. Harga lokasi lain = rekomendasi, tak pernah dipakai sendiri;
           AI boleh memberi DRAF harga, tetapi baru menjadi HSD setelah disetujui manusia)
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
| `src/lib/progress-calc.ts` | MURNI: `prestasiPct`, `itemAchievement`, `realizedPctFromItems`, `bobotPct`, `realisasiKategoriPct` |
| `src/lib/progress.ts` | akses DB: `grandTotal`, `realized`, `planPct`, `deviationPct`, `COUNTED_REPORT_STATUSES` |
| `src/lib/finance/calc.ts` | agregat keuangan + `unbilledWork`, `alokasiBelumTertagih`, `totalPortofolio` |
| `src/lib/plan/rencana-format.ts` | MURNI: penilaian RENCANA — `hitungProyeksi`, `hitungPpc`, `statusDeviasi`, `labelKejar` (DECISIONS 258) |
| `src/lib/ahsp/rapl-calc.ts` | MURNI: kebutuhan + biaya RAPL (DECISIONS 320/327) |

**Daftar LIMA berkas di atas adalah satu-satunya daftar yang berlaku**
(DECISIONS 461). `CLAUDE.md` dan `docs/rebuild/CALCULATION_INTEGRITY_PROTOCOL.md`
merujuk ke sini, tidak menyalinnya — sampai audit 2026-08-28 ketiganya memuat
daftar yang BERBEDA, dan gerbang anti-duplikasi tidak bisa ditegakkan kalau
patokannya sendiri bercabang.

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

# Penilaian rencana mingguan (DECISIONS 258) — lib/plan/rencana-format.ts
proyeksiPct   = realizedPct + bobotPct(Σ nilai komitmen, grandTotal)
selisihPct    = proyeksiPct − planPct(minggu ini);  tertinggal bila < −0,01
PPC           = komitmen TUNTAS / komitmen × 100    ← BINER per komitmen, bukan tertimbang volume
realisasi PPC = kumulatif s/d akhir minggu − kumulatif s/d sehari sebelum minggu mulai
                                                    ← SELAMA minggu itu; kumulatif apa adanya = PPC palsu
tanpa rencana minggu lalu ⇒ PPC null (BUKAN 0 — "tidak berjanji" ≠ "gagal total")
```

Level status yang dihitung: ANGKA RESMI tetap `COUNTED_REPORT_STATUSES` =
dikirim + disetujui + final. Sejak DECISIONS 426 `getLocationsProgress` punya
parameter opsional `statusLevel: "terverifikasi"` (= `VERIFIED_REPORT_STATUSES`,
disetujui + final — rumus & penyebut SAMA, hanya saringan status) sebagai angka
PENDAMPING berlabel "Progress Terverifikasi" (dipakai mesin kesiapan
termin/PHO). Memindahkan BASIS resmi ke level terverifikasi tetap keputusan
terbuka — lihat docs/OPEN_ISSUES.md. Kurva-S: smoothstep per fase kategori + penjadwalan
per-trade. PPN: RAB pre-PPN vs kontrak incl-PPN, warning selisih >0.1%.

Invarian yang dijaga uji (`tests/integration/periodic-report.test.ts`): kolom
laporan berjumlah, "s/d" tidak pernah mundur antar periode, Σ bobot = 100,
dashboard = kurva ringkasan lokasi = blanko KKP, lineage mati tidak ikut,
draft tidak dihitung, grandTotal 0 tidak menghasilkan NaN, lokasi tidak
tercampur.

## 4. Permission

Capability-based (`src/lib/authz.ts`, matrix di docs/rebuild/PERMISSION_MATRIX.md).
8 role: super_admin, program_director, regional_manager (Area Manager),
project_manager, site_manager, field_supervisor (Mandor), exec_viewer,
wakil_ppk (Wakil PPK — VERIFIKATOR pemberi kerja, DECISIONS 426: capability
tulisnya hanya domain pemeriksaan — finding.create/verify, inspection.manage,
report.verify_external; tanpa `ai.*`/`finance.*`, sesuai penugasan lokasi).
Cross-location: super_admin & program_director SAJA; lainnya (termasuk
exec_viewer — DECISIONS 190 — dan wakil_ppk) via LocationAssignment. Backend selalu re-check (`requireCapability` +
`requireLocationAccess`); middleware hanya redirect login. Session DB revocable;
rate limit login; wajib ganti password first-login; audit log tiap mutasi.
RLS TIDAK diklaim (lihat OPEN_ISSUES).

## 5. Informasi arsitektur

(docs/rebuild/TARGET_INFORMATION_ARCHITECTURE.md = ARSIP rebuild; IA
pengendalian terpadu di docs/integrated-control/UX_INFORMATION_ARCHITECTURE.md.)
Menu: Beranda (Command
Center exception-first) · Paket (workspace tab: Ringkasan/Tender/Kontrak &
Adendum/Lokasi/Dokumen/Aktivitas) · Lokasi (workspace tab: Ringkasan/Rencana &
RAB/RAPL (Ringkasan estimasi → Kebutuhan & Harga → Validasi breakdown;
biaya dan potensi margin memakai nilai RAB aktif lokasi; cetak A4
`/cetak/rapl/[slug]` + unduh xlsx; kebutuhan volume `rab.view`, uang & margin
`rapl.view` (PM ke atas + exec_viewer), mengisi HSD/rincian `rapl.manage`
(SM ke atas) — sengaja BUKAN `finance.*` yang milik menu Keuangan)/Pelaksanaan Harian/Progress/Keuangan/Dokumen & Kepatuhan/Laporan) ·
Hari Ini (landing lapangan mobile) · Progress · Kendala · **Temuan** (papan
temuan pemeriksa + register .xlsx) · **Verifikasi** (workspace Wakil PPK:
antrean laporan, inspeksi, temuan menunggu verifikasi) · **Perlu Tindakan**
(EWS rule-based, tanpa AI) · **Kesiapan** (termin/PHO/FHO/close-out per paket)
· Keuangan · Dokumen · Laporan · Pengguna · Sistem — empat menu tercetak tebal
= Pengendalian Terpadu, DECISIONS 426; rincian di `docs/integrated-control/`.
Cetak KKP di `/cetak/*` tanpa shell. Mobile bottom-nav ≤5 tujuan per role
(wakil_ppk punya baris khusus: Beranda/Verifikasi/Temuan/Lokasi).

## 5a. AI Intelligence Hub (DECISIONS 133, 193)

**Doktrin (DECISIONS 193)**: AI Intelligence adalah MESIN ANALISIS & PRODUKSI
ARTEFAK — bukan fitur visual atau chatbot. Setiap analisis yang relevan harus
dapat berakhir menjadi laporan terstruktur yang direview → disetujui → dibekukan
→ diekspor PDF/Excel → didistribusikan WhatsApp → diaudit. Semua pintu keluar AI
bermuara ke lifecycle `AiArtifact`; tidak boleh ada jalur generate-lalu-kirim
tanpa review.

Menu global `/ai` (capability `ai.*`; field_supervisor tanpa akses): Portfolio
Pulse (KPI + tabel exception-first + readiness gate — deterministik penuh,
berfungsi tanpa provider AI), Perlu Tindakan (antrean rule risiko; simpan =
draft saran, TIDAK menulis Issue/Recovery), Report Studio (8 template; satu
structuredContent → pratinjau/cetak-A4/WA/Excel dgn angka identik; lifecycle
draft→direview→disetujui→beku→terkirim via lifecycle.ts; beku immutable),
Ask MARLIN (grounded, read-only, bersitasi, percakapan tersimpan; pertanyaan
DICATAT lalu dijawab di latar — request tidak menahan panggilan provider,
percakapan menandai dirinya `pendingSince` dan layar menunggu, DECISIONS 455;
scope percakapan bisa dibawa ke Report Studio; klaim angka TERIKAT lokasi+metrik+
nilai+periode+sumber & keyakinan DIHITUNG — 0 bila tak ada klaim sah,
DECISIONS 378; sumber kontrak/keuangan/RAB/milestone lewat adapter yang
dipagari kapabilitas penanya — `finance.view` dst., DECISIONS 379), Riwayat & Audit (usage token/latency/
estimasi biaya per run). Laporan WA eksekutif = template `wa_update` di Report
Studio (menu Laporan → WA lama dilebur, route `/laporan-wa` dialihkan —
DECISIONS 194); distribusi artefak beku menerima kontak tersimpan ATAU
nomor/id grup bebas. Prinsip: **AI bukan sumber
angka** — semua angka dari calc layer; output AI lolos zod + validasi scope +
sourceRef + klaim angka, bagian gagal dibuang jadi limitation. In-process (tanpa
service/Redis/MCP/agent framework); guard AppSetting: kill switch + rate limit +
batas ukuran; API key provider terenkripsi AES-256-GCM (`AI_SECRET_ENCRYPTION_KEY`).

**Prompt semua aksi AI** diatur di Sistem → Prompt AI (registri
`src/lib/ai/prompt-registry.ts`, override AppSetting `ai.prompt.*`). Frasa
pengaman anti-mengarang per slot tidak bisa dihapus lewat halaman itu
(DECISIONS 180).

## 6. Alur harian (jantung sistem)

Mandor/SM buka **Hari Ini** → workspace tanggal `/lokasi/[slug]/harian/[date]` →
(riwayat lengkapnya di `/lokasi/[slug]/harian`: **kalender per bulan** yang
menjangkau seluruh masa kontrak + bentuk daftar ber-AG Grid; hari di luar masa
kontrak & hari yang belum tiba TIDAK dihitung sebagai "belum lapor" —
DECISIONS 340) →
pilih item RAB (sisa volume tampil) → isi volume + foto (kompresi + EXIF + stamp,
dedup sha256) + kendala → kirim. SM verifikasi di layar yang sama: kembalikan
(alasan wajib) atau lengkapi KKP (tenaga/material/alat/cuaca/jam) → setujui →
final (snapshot) → cetak KKP harian. **Cuaca**: blanko minta kondisi PER JAM
(07–21). Tombol "Ambil cuaca otomatis" mengisinya dari koordinat lokasi (jam
yang sudah lewat, bukan prakiraan — DECISIONS 176); isian manual lapangan
selalu menang dan tak pernah ditimpa otomatis; angin kencang & banjir hanya
dari pengamatan. Integritas: uniq(lokasi,tanggal) +
uniq(report,lineage) di DB; kumulatif ≤ volume RAB; revisi tidak dihitung dobel;
draft volume tersimpan lokal (localStorage) sampai submit sukses.

**Kegiatan lapangan**: teks bebas diisi tanpa gangguan; saat **Finalkan**
muncul pilihan "Rapikan bahasa" / "Bahasa teknis" / "Finalkan apa adanya".
Perapian memanggil AI sekali untuk seluruh teks bebas, menampilkan asli vs
usulan per bagian dengan centang masing-masing, dan hanya menyimpan yang
dicentang. Usulan yang menambah/membuang angka atau melar dari teks asli
ditolak penjaga deterministik per bagian (DECISIONS 178/179).

## 7. Keuangan

Transaction-based; agregat derived (SATU-satunya tempat formula:
`lib/finance/calc.ts`): availableBudget = budget − realisasi −
komitmen-belum-realisasi; outstanding = invoice disetujui − pembayaran;
unbilled = terpasang **dilaporkan** (dikirim+disetujui+final; BELUM tentu
terverifikasi — lihat KEPUTUSAN level status di OPEN_ISSUES) di-gross-up ke
incl-PPN via `Contract.ppnPercent` − tertagih (incl-PPN); cashRequirement =
komitmen jatuh tempo + forecast − kas − pencairan terjadwal. Approval flow di
semua transaksi; `finance.approve` terpisah dari input dan dari `user.manage`;
**empat mata**: pengaju tidak boleh menyetujui transaksinya sendiri
(super_admin boleh break-glass, ter-audit `selfApprove`). Pembayaran/pencairan/
expense memakai `SELECT … FOR UPDATE` (`lib/finance/apply.ts`) — guard sisa
tahan race. Retensi termin ≤ `Contract.retentionPercent` (boleh lebih kecil —
retensi dapat diganti jaminan pemeliharaan).

## 8. Deployment

Railway, builder DOCKERFILE (Nixpacks dilarang). Node 24 pinned, image
bookworm-slim, non-root, tini, standalone Next, preDeploy `prisma migrate deploy`,
healthcheck `/api/health` (DB; R2 bukan hard-dep). Env divalidasi zod saat startup;
endpoint R2 dinormalisasi (tolak r2.dev/protokol ganda/path). CI wajib hijau
sebelum merge. Reset DB hanya APP_ENV development/test dgn guard ganda.

## 9. Testing

docs/rebuild/TEST_PLAN.md. Unit (formula, parser, authz, env, lifecycle),
integration (constraint DB, transaksi+race, append-only, golden fixtures
laporan periodik). E2E Playwright saat ini baru mencakup auth + otorisasi
dasar (`tests/e2e/auth.spec.ts`); alur kritis lain (prospek→kontrak, RAB
import, siklus laporan, keuangan) diverifikasi via integration + uji browser
manual terdokumentasi di DECISIONS — penambahan E2E dicatat sebagai defer.
Definition of Done = prompt rebuild §38 + traceability matrix terisi.

## 9a. Luring (PWA)

Service worker `public/sw.js` (kebijakan terpisah + diuji di
`public/sw-kebijakan.js`): aset build ber-hash disimpan; **hanya `/foto-cepat`**
yang HTML-nya disimpan sehingga bisa dibuka dari nol tanpa sinyal, dengan banner
"ditampilkan dari simpanan" + tanggal rekamannya; navigasi lain yang gagal
jatuh ke `/offline` (halaman itu menyatakan Foto Cepat siap/belum, apa adanya).
Jaringan SELALU dicoba lebih dulu. Tidak menyentuh non-GET, `/api/**`, muatan RSC,
dan lintas asal. Jawaban yang beralamat akhir lain (mis. alihan ke `/masuk` karena
sesi habis) tidak pernah disimpan. Halaman lapangan DISIAPKAN otomatis tiap
aplikasi dibuka (jeda 15 menit; hanya role ber-`photo.quick`) — mode pesawat tak
lagi menuntut halamannya pernah dibuka. Simpanan halaman dibuang saat pemilik HP
berganti dan saat `/masuk` dibuka. `/offline` WAJIB ada di `PUBLIC_PATHS`
(`src/middleware.ts`) — kalau ia dialihkan ke `/masuk`, prapasang service worker
menyimpan halaman masuk di bawah kunci `/offline`. Tidak aktif di `pnpm dev`.
DECISIONS 398/399.

### Pasang PWA dari dalam aplikasi

`beforeinstallprompt` ditahan skrip inline di root layout (event bisa lewat
sebelum React siap, dan tidak bisa diminta ulang), lalu ditawarkan lewat DUA
permukaan: banner yang bisa ditutup 14 hari, dan tombol ringkas di topbar yang
TIDAK ikut diredam — supaya menutup banner tidak mengembalikan orang ke menu ⋮
peramban. iOS tidak punya event ini, jadi di sana yang tampil petunjuk Bagikan →
Tambahkan ke Layar Utama. DECISIONS 405.

### Penanda tangan dokumen KKP

Harian & mingguan diteken **Pelaksana Lapangan**; bulanan, MC, dan CCO diteken
**Direktur** (`Contract.contractorSigner*`). Aturannya HANYA di
`src/lib/laporan/penandatangan.ts`; `muatTtdLaporan`/`muatTtdPdf` menuntut jenis
dokumen supaya tiap pemanggil menyatakan yang ia cetak. Pelaksana disimpan di
`Package.pelaksana*` dan boleh ditimpa `Location.pelaksana*` — diambil sebagai
SATU BLOK (nama menentukan), jadi tanda tangan tidak pernah dipinjam antar
orang. Yang kosong dicetak sebagai baris kosong + peringatan di layar, TIDAK
jatuh ke Direktur.

Lembar **kurva-S** ikut dokumen tempat ia berada, bukan isinya: di dalam laporan
periodik ia halaman pertama LAPORAN (ikut jenis laporannya), sebagai Time
Schedule berdiri sendiri ia dokumen JADWAL (Direktur). `ScurveKkpSheet` dan
`addKurvaSheet` menuntut `jenis`. Rencana Mingguan belum diputuskan, tetap
Direktur.

Dari pihak KKP, laporan **mingguan & bulanan** diteken **WAKIL SAH**
(`Contract.wakilSah*`, timpaan `Location.wakilSah*` — blok utuh, nama
menentukan); dokumen lain (kurva-S/jadwal, MC, CCO, harian) tetap **PPK**.
Penentunya satu: `pihakKkp(jenis)` di `penandatangan.ts`. Stempel slot KKP
tetap `ppkStempelKey` — stempel milik INSTANSI, bukan orang (DECISIONS 408).
Keputusan user 2026-08-24 (DECISIONS 427).

Pelaksana tingkat paket diisi di formulir penanda tangan kontrak yang SAMA
dengan PPK/Wakil Sah/pengawas/Direktur (nama + gambar TTD); penimpaan per
lokasi punya formulir sendiri di halaman lokasi karena PPK & pengawas memang
urusan paket. Logo/kop/stempel perusahaan tetap di master vendor; logo firma
PENGAWAS di kontrak (`Contract.supervisorLogoKey`) dan tampil di kop blanko
harian. DECISIONS 402/403/404/427.

### Periode minggu laporan (M1–MN)

Per kontrak (`Contract.weekMode`, DECISIONS 427):

- `tujuh_hari` (bawaan, perilaku lama): minggu ke-n = [SPMK + (n−1)×7 hari, +6 hari].
- `senin_minggu`: minggu KALENDER Senin–Minggu; M1 (dan minggu terakhir) bisa
  pendek — SPMK Kamis ⇒ M1 = Kamis–Minggu (4 hari).

Helper murninya HANYA di `progress-calc.ts` (`weekOfDate`, `weekDateRange`,
`totalWeeksBetween`); `currentWeekNumber` (progress.ts) menerima mode. Semua
kolom M1–MN (layar, PDF, Excel) menampilkan rentang tanggal minggunya.
Mengubah mode lewat koreksi kontrak menghitung ulang kurva-S semua lokasi.

## 10. Scope yang sengaja ditunda

Peta Leaflet, offline di luar `/foto-cepat` + background sync + push (butuh
cangkang native — DECISIONS 398), PR/PO/receiving granular, intake WA-text —
tercatat di OPEN_ISSUES + REBUILD_PLAN dgn alasan.
