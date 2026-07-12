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
- ✅ **Detail approval**: dilaporkan / kumulatif (vs rencana, %) / sisa + pelapor + tanggal + catatan + foto
- ✅ Section **"Sudah disetujui"** (riwayat sent + penyetuju + waktu)
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
