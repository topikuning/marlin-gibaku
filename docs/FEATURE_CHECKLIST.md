# MARLIN — Feature Checklist (re-checked)

Status per **12 Jul 2026**. Di-recheck terhadap kode nyata (routes, lib, migrasi),
bukan dari ingatan. Legenda:

- ✅ **Selesai & terverifikasi** sesi ini (E2E Playwright / query DB / build)
- ☑️ **Terbangun** (compile + build lolos) tapi belum diverifikasi ulang runtime sesi ini
- 🟡 **Sebagian** (ada, tapi belum lengkap)
- ⬜ **Belum dibangun**
- 🔴 = risiko keamanan/kualitas penting

> Catatan: banyak fitur bergantung **R2** (foto/dokumen). Kalau env R2 belum di-set
> di Railway, upload tetap tercatat tapi file tak tampil (muncul placeholder).

---

## 1. Auth & Akses
- ✅ Login username **atau** email + password (Argon2) — `src/app/(auth)/masuk`, `auth.ts`
- ✅ Otorisasi server-side per role (`notFound()` guard, bukan cuma sembunyi nav)
- ✅ Scoped access: role non-cross-location hanya lihat lokasi yang ditugaskan
- ☑️ Session expiry per role (`absExp`, DECISIONS 012)
- ⬜ OTP WhatsApp / device binding (DECISIONS 003 asli) — **di-drop** ke password-only atas keputusan user

## 2. Shell & Navigasi
- ✅ App shell: header brand (glow dot + "Monitoring KNMP"), nav pill per role, footer build badge
- ✅ Beranda = hub/overview (menu Dashboard digabung ke Beranda)
- 🟡 Rombak total UI/UX (design system) — **baru shell**; revamp per-halaman menyeluruh belum

## 3. Lokasi & RAB
- ✅ Daftar lokasi + halaman detail lokasi
- ☑️ RAB tree sampai sub-item (`/lokasi/[slug]/rab`)
- ✅ Import HPS Excel → pohon RAB (parser toleran, terverifikasi 13/13 kategori)
- ✅ RAB revisioning Model A (snapshot) + **adendum** + carry-over realisasi by lineage
- ✅ Grand total = SUM kategori aktif (konsisten detail & dashboard)

## 4. Kurva-S
- ✅ Generate otomatis dari RAB + durasi kontrak
- ✅ **Ber-versi** + **editable** (halaman Atur Kurva-S) + **regenerate saat adendum** (histori tersimpan)
- ✅ **Pembobotan per item** + klasifikasi 11 trade (dari analisis 7 RAB, cakupan ~97%)
- ✅ **Jadwal dependensi** + **saran pekerjaan per minggu**
- ✅ Chart kurva-S visual (SVG, rencana vs realisasi) di detail lokasi

## 5. Lapor Harian (mandor / SM)
- ✅ Input volume + **foto dari kamera**
- ✅ **Mobile-first**: search item (bukan select 1000), kartu terpilih, sticky simpan
- ✅ **Validasi volume > rencana** (diblokir server-side dgn pesan sisa)
- ✅ Satuan jelas (badge unit + rencana + maksimal)
- ✅ Mandor lapor (draft) → SM setujui
- ☑️ Admin (super_admin/PD) bisa ikut lapor
- ⬜ Offline/queue untuk sinyal lemah
- ⬜ Input via WA text template (WAHA) — belum

## 6. Laporan & Persetujuan
- ✅ SM setujui / tolak draft (dengan alasan)
- ✅ **Detail approval** ringkas di kartu: dilaporkan / kumulatif (vs rencana, %) / sisa
- ✅ **Halaman detail laporan** (`/laporan/[id]`): klik kartu → detail penuh (volume/kumulatif/sisa, pelapor + penyetuju + waktu, semua foto besar, tombol setuju/tolak)
- ✅ Section **"Sudah disetujui"** (riwayat sent + penyetuju + waktu), tiap item bisa diklik ke detail
- ☑️ Admin (cross-location) lihat **semua** laporan

## 7. Foto
- ✅ Upload ke R2 + dedup sha256 (`lib/photos.ts`)
- ✅ Tampil thumbnail di: Lapor Harian, Approval, Peta; placeholder saat R2 belum aktif
- ⬜ Verifikasi EXIF/GPS/waktu (`PhotoVerification` masih selalu `pending`)

## 8. Peta
- ✅ Peta Leaflet + titik per lokasi (warna per status)
- ✅ Klik titik → panel progress (realisasi vs rencana) + **fase minggu ini** + **foto terbaru** + link detail

## 9. Pengadaan (PBJ)
- ✅ **Status per lokasi** (dropdown set inline, admin) — 8 tahap belum_diundang→SPMK
- ✅ Tampilan eksekutif: KPI (HPS/Kontrak/Selisih) + funnel per tahap
- ✅ Scoped (Area Manager hanya area-nya)

## 10. Kontrak & Kontraktor
- ✅ Master data kontrak + kontraktor (1 kontraktor N kontrak, 1 kontrak N lokasi)
- ✅ Tampil dalam **data grid** (sort/search)

## 11. Pengguna
- ✅ CRUD user + role + penugasan lokasi
- ✅ Data grid (sort/search) + aktif/nonaktif

## 12. Dashboard / Progress
- ✅ Progress realisasi vs rencana (kurva-S) per lokasi + deviasi + KPI (di Beranda)

## 13. Arsip Dokumen
- ☑️ Arsip dokumen per lokasi mengikuti siklus PBJ (upload/list/download presigned)
- 🟡 Indikator kelengkapan per tahap — dasar; belum lengkap

## 14. Data Grid (open-source)
- ✅ Komponen `DataGrid` (TanStack Table v8, MIT): sort, global search, sticky header
- ✅ Diterapkan: Pengguna, Kontrak/Kontraktor
- ⬜ Diterapkan ke: Pengadaan (masih tabel dropdown), RAB tree
- ⬜ Pagination/virtualization, column resize

## 15. Deploy / Data
- ☑️ Railway `release.sh` (migrate deploy + seed kondisional `SEED_ON_DEPLOY`)
- ✅ Seed 7 lokasi dari HPS nyata; **tahan re-run** (fix FK)
- ✅ Footer build badge (diagnosa versi live)

---

## BELUM DIBANGUN (jujur, prioritas)

- ⬜ 🔴 **RLS (row-level security)** Postgres — belum ada policy
- ⬜ 🔴 **Rate limiter** (login/API)
- ⬜ 🔴 **Test suite otomatis** (unit/E2E) — verifikasi masih manual per PR
- ⬜ **Export laporan resmi KKP** (PDF/Excel) — belum
- ⬜ **Laporan mingguan/bulanan** — model `WeeklyReport`/`MonthlyReport` ada di schema, UI belum
- ⬜ **WA/WAHA integration** (mandor lapor via WhatsApp)
- ⬜ **PWA / offline**
- ⬜ **Org chart visual Area Manager** (bagan seperti app Cloudflare)
- ⬜ **Notifikasi / alert** (model `Alert` ada, UI belum)
- ⬜ **Rombak total UI/UX** menyeluruh (baru shell)

### Model di schema tapi belum ada UI/alur
`WeeklyPlan`/`WeeklyPlanItem`, `WeeklyReport`, `MonthlyReport`, `Alert`,
`AuditLog`, `Device`, `OtpCode`, `SyncQueue`, `ContractAmendment`,
`BudgetLine` (di-seed, belum ada UI), `ScheduledMilestone` per-item (baru level lokasi).

---

## Cara verifikasi mandiri (akun demo, password `password123`)
`admin` (Super Admin) · `direktur` (PD) · `regional-jateng` (Area Manager) ·
`pm-nusantara` (PM) · `sm-kedungmutih` (Site Manager) · `mandor-01` (Mandor) ·
`exec-kkp` (Exec KKP). Lihat checklist per role: Beranda → Peta → Lokasi (RAB,
Kurva-S, Dokumen) → Lapor Harian (mandor) → Laporan (SM setujui) → Pengadaan →
Kontrak → Pengguna.

---

## Update 2026-07-13 — recheck untuk QC

Ditambahkan & terverifikasi (build/typecheck + Playwright) sejak versi awal checklist:

- ✅ **Command center widgets**: Forecast penyelesaian per proyek, Perlu Tindakan (persetujuan tertunda), Aktivitas Terakhir
- ✅ **Halaman detail laporan** (`/laporan/[id]`) — klik kartu → detail penuh + foto besar + aksi
- ✅ **Tenaga kerja + kendala** di lapor harian; tampil di detail
- ✅ **Penyebab deviasi + recovery plan** per lokasi (editor admin di detail lokasi)
- ✅ **Modul Keuangan** (`/keuangan`): serapan, selesai belum ditagih, pengeluaran vs pagu, kebutuhan dana 30 hari (input manual + derivasi)
- ✅ **Pencarian item lapor mandor** menampilkan kategori/sub (disambiguasi nama sama)
- ✅ **Semua tabel = DataGrid** (Lokasi, Beranda Kinerja Proyek, Pengadaan, Keuangan, Pengguna, Kontrak) — sortable + global search (semua field) + sticky
- ✅ **Diagnostik R2** (`/diagnostik`) — tes koneksi Cloudflare round-trip
- ✅ **Reset Data operasional** (Diagnostik, super_admin): hapus laporan+foto+biaya, master & kurva-S TETAP
- ✅ **Shell enterprise**: sidebar kiri + ikon, PageHeader konsisten, kartu 8px, tabular numerals, tanpa gradient/glass
- ✅ **Nav diurut ulang** (alur login→pantau→kelola), Diagnostik paling bawah
- ✅ **Fix kurva-S**: label minggu terakhir tak lagi keklip ("mgg 22")

## Update 2026-07-13 (b) — akomodasi format resmi KKP/DJPT

Berdasar paket dokumen kementerian (Alur Administrasi, template BA/Surat, FORMAT
LAPORAN HARIAN, MC-0, CCO, time schedule):

- ✅ **Tracker Alur Administrasi KNMP** (`/lokasi/[slug]/administrasi`): checklist
  45 milestone (8 fase) + PIC per item, status ✓ auto-deteksi dari Arsip Dokumen
- ✅ **Laporan Harian format KKP** (`/lokasi/[slug]/harian/[date]`): mandor ringkas,
  SM lengkapi tenaga per keahlian (14 peran) + material + peralatan + cuaca + jam;
  realisasi auto-join dari laporan lapangan; kartu print-friendly (Cetak/PDF) — DECISIONS 038
- ⬜ Export KKP: cover harian/mingguan/bulanan + FORMAT DOKUMENTASI (foto + bobot%)
- ⬜ MC-0 / CCO view + export (tambah/kurang dari RAB revisi)
- ⬜ Generator template Berita Acara / Surat (docx)

Detail spec & keputusan: `docs/DECISIONS.md` #037.

## Update 2026-07-13 (c) — QC batch terbaru

Cara cek per item (login `admin`/`password123`):

- ✅ **Palet warna KNMP navy** + aksen merah brand mark — cek login & seluruh app
- ✅ **Reset penuh "mulai dari nol"** (Diagnostik → Zona Berbahaya, ketik `RESET SEMUA`):
  hapus SEMUA data contoh, sisakan akun login. Untuk mulai data real.
- ✅ **Laporan Harian KKP menonjol** di menu **Laporan** (SM/admin) — link per lokasi
- ✅ **Cetak Laporan Harian = FORMAT LAPORAN HARIAN KKP** (form bergaris A4): header
  Pengawas/Kontraktor, tenaga 14 keahlian, material, peralatan, cuaca per jam,
  rencana/realisasi, TTD — tombol **Cetak/PDF** di `/lokasi/[slug]/harian/[date]`
- ✅ **Foto di-cap (stamp) gaya Timemark** SEBELUM simpan: waktu + tanggal + nama
  lokasi + koordinat GPS + watermark MARLIN dibakar ke gambar. Koordinat dari GPS
  HP saat ambil foto (izinkan lokasi). Cek: Lapor Harian → ambil foto → simpan
- ✅ **Foto: thumbnail kecil + lightbox in-page** (bukan tab baru) + tag EXIF
- ✅ **Menu "Pengadaan" → "Paket"** (`/paket`): daur hidup paket. **Prospek** (tender)
  → "Prospek baru" → isi HPS + desa → tahap → **"Jadikan Kontrak"** (buat kontrak
  nilai final + lokasi otomatis). Cek: Paket → Prospek baru
- ✅ **Sidebar sticky** — menu tetap terlihat saat scroll
- ✅ **Rebranding**: MARLIN = Monitoring, Analysis, Reporting & Learning for
  Infrastructure Network (login, sidebar, judul)

**Catatan verifikasi**: cetak Laporan Harian & alur foto di browser tak bisa
di-screenshot sesi ini (server sandbox berhenti nerima koneksi); logika stamp foto
diverifikasi terpisah (render sharp langsung ✓). Cek visual final di deploy.

Keputusan detail: `docs/DECISIONS.md` #037–#040.

---

**Masih belum** (jujur): export laporan KKP (PDF/Excel), laporan mingguan/bulanan,
org-chart Area Manager, dark mode, WA/WAHA, PWA/offline, hardening 🔴 (RLS,
rate-limiter, test otomatis), integrasi keuangan otomatis (masih manual), restyle
komponen dalam RAB-tree/Dokumen ke token baru.

**Di mana cek**: file ini (`docs/FEATURE_CHECKLIST.md`) di GitHub repo, atau lewat
Beranda (Command Center) untuk lihat fitur berjalan langsung.
