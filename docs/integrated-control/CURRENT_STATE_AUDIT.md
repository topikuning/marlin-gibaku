# CURRENT_STATE_AUDIT — Integrated Project Control & Assurance

> Phase 0 dari inisiatif "Integrated Project Control & Assurance Platform"
> (prompt user 2026-08-24). Audit repo SEBELUM menulis kode. Semua path
> mengacu ke kondisi branch `claude/marlin-integrated-control-hag83c` saat
> bercabang dari main (commit c83109c).

## 1. CURRENT STATE — apa yang sudah ada

### Sudah ada & KUAT (tidak disentuh, hanya dipakai)

| Kebutuhan prompt | Fitur existing | Lokasi |
|---|---|---|
| Laporan harian + workflow verifikasi internal | `DailyReport` draft→dikirim→perlu_koreksi→disetujui→final; mesin transisi + histori append-only + advisory lock + pemisahan tugas berbasis orang | `src/lib/daily-report/`, `src/lib/lifecycle.ts` |
| Calculation layer | `progress-calc.ts` (murni) + `progress.ts` (DB) + `finance/calc.ts` + `plan/rencana-format.ts` | `src/lib/` |
| Evidence foto | `Photo` (sha256 dedup, arsip asli, GPS source, stamp revision append-only) menempel ke laporan/item/material/alat/kegiatan | `prisma/schema.prisma`, `src/lib/photo*` |
| Dokumen + versi | `Document` (version chain `supersedesId`, void/restore, `expiryDate`, sumber unggahan/Drive KKP, nama diturunkan dari data) | `src/lib/documents*.ts` |
| **Document requirement matrix** | **`AdminMilestone` template 45 item KKP** — per fase (pemilihan…pembayaran), scope paket/lokasi, `requiresVerification`, PIC, dueDate, auto-link dokumen→milestone, papan kelengkapan (`milestoneBoard`) | `src/lib/milestones/` |
| Kendala + follow-up | `Issue` → `RecoveryAction` → `RecoveryUpdate`, papan `/kendala`, penagih WA cron, dedup, merge | `src/lib/issues.ts`, `src/lib/kendala/` |
| Permission | Capability-based 8 role, jenjang superset, `requireCapability` + `requireLocationAccess` di tiap aksi, scope via `LocationAssignment` | `src/lib/authz.ts`, `src/lib/auth/` |
| Audit trail | `AuditLog` append-only; `audit()` best-effort + `auditIn()` transaksional (AUDIT-01) | `src/lib/audit.ts` |
| Rule engine deterministik | ai-hub: `risk.ts` (Perlu Tindakan), `readiness.ts` (readiness DATA), `quality-rules.ts` (9 rule kualitas data) | `src/lib/ai-hub/` |
| Report products | Harian KKP, mingguan bundle, periodik, rencana mingguan, jadwal, RAPL, RAB/CCO xlsx, Paparan KKP deck, AI report (preview=PDF=WA=Excel dari satu structuredContent) | `src/lib/pdf/`, `src/lib/export/`, `src/app/cetak/` |
| WA integration | Gateway kanonik `sendWaMessage` (outbox + ack), legacy `sendText/sendFile` | `src/lib/waha/gateway.ts` |
| Drive integration | `uploadBatch` + antrean otomatis + struktur folder KKP | `src/lib/gdrive/` |
| AI Intelligence | Hub 6 tab; AI bukan sumber angka; artefak lifecycle draft→…→beku→terkirim | `src/lib/ai-hub/`, `src/app/(app)/ai/` |
| Cron | `/api/cron/harian` (SPMK, pengingat, mingguan WA, kendala tenggat, nihil) + gdrive + waha | `src/lib/harian/penjadwal.ts` |

### Overlap yang WAJIB tidak diduplikasi

1. **"Perlu Tindakan" sudah ada** di `/ai/actions` (rule `risk.ts`, deterministik,
   4 rule: deviasi jadwal, readiness data, kendala/recovery, milestone). EWS baru
   harus MEMPERLUAS keluarga rule ini, bukan membuat mesin kedua yang menghitung
   deviasi sendiri. Bedanya: `/ai/actions` di balik `ai.view` (Wakil PPK tidak
   punya), periode hardcoded 14 hari, dan cakupan rule-nya belum meliputi
   dokumen/temuan/kontrak.
2. **"Readiness" ai-hub = kesiapan DATA** (bisakah angka dipercaya), bukan
   kesiapan TERMIN/PHO. Dua konsep berbeda; keduanya dipertahankan dengan nama
   berbeda: `readiness` (data, ai-hub) vs `kesiapan` (termin/PHO/FHO, baru).
3. **`Issue` (kendala) ≠ `Finding` (temuan)**. Kendala = hambatan yang dilaporkan
   pelaksana (hujan, lahan, material). Temuan = ketidaksesuaian yang dicatat
   PIHAK PEMERIKSA dan menuntut tindak lanjut + verifikasi penutupan. Siklusnya
   berbeda (temuan punya klarifikasi + verifikasi penutupan + buka kembali).
   Keduanya dipertahankan; temuan TIDAK menggantikan kendala.
4. **`AdminMilestone` = document requirement matrix.** Prompt §7 minta matrix
   per fase dengan required/PIC/due/status/verifikasi — semuanya sudah ada di
   template 45 item. Yang kurang bukan modelnya, tapi: (a) peringatan expiry,
   (b) mesin kesiapan termin/PHO yang MEMBACA matrix itu, (c) verifikasi oleh
   pihak eksternal. Tidak dibuat model `DocumentRequirement` baru.
5. **`Alert` model ADA tapi mati** (0 pembaca, 0 penulis sejak rebuild). EWS
   dihitung on-the-fly dari data sumber (prinsip "agregat selalu derived");
   model `Alert` tidak dihidupkan kembali.
6. **Evidence sudah punya rumah**: `Photo` dan `Document`. Abstraksi evidence =
   TABEL TAUTAN ke keduanya (tanpa duplikasi berkas), bukan penyimpanan baru.

### Reusable langsung

- UI: `PageHeader`, `KpiCard`, `Card*`, `StatusPill` (+ lifecycle label/tone),
  `Banner`, `Combobox`, `Drawer`/`PanelGeser`, `EmptyState`, `LinkTabs`,
  `SubTabs`, `MarlinGrid`, `ConfirmSubmit`, `useAksiKlik`.
- Pola server action: `"use server"` + zod + `guard()` (capability+lokasi) +
  `audit`/`auditIn` + `revalidatePath` + `fail()` (contoh kanonik `src/lib/issues.ts`).
- Pola halaman papan: `/kendala` (KPI cards → filter → kartu daftar).
- Pola test: unit authz exhaustive (`tests/unit/authz.test.ts`), integrasi
  workflow (`tests/integration/daily-report-flow.test.ts`), trigger append-only
  (`prisma/migrations/20260714005500_append_only_triggers`).

## 2. GAP ANALYSIS — yang benar-benar belum ada

| # | Gap | Catatan |
|---|---|---|
| G1 | **Model Temuan formal** dengan siklus baru→klarifikasi→tindak lanjut→verifikasi→selesai→buka kembali | Issue tidak punya klarifikasi, verifikasi penutupan oleh pemeriksa, atau reopen |
| G2 | **Wakil PPK tidak bisa berbuat apa-apa** — DECISIONS 199 membuatnya murni read-only; tidak ada workspace, tidak ada aksi verifikasi | Diubah sadar oleh prompt ini (lihat DECISIONS 426) |
| G3 | **Verifikasi laporan harian oleh pihak eksternal** — `disetujui` hari ini adalah persetujuan INTERNAL (SM); tidak ada jejak pemeriksaan wakil pemberi kerja | Lapisan `ReportVerification` terpisah, tidak menyentuh angka resmi |
| G4 | **Inspeksi lapangan** — tidak ada entitas catatan inspeksi (tanggal, catatan, rekomendasi, temuan turunan, bukti) | `FieldActivity` mirip tapi milik pelaksana, bukan pemeriksa |
| G5 | **Kesiapan termin/PHO/FHO** — OPEN_ISSUES sudah mencatatnya sebagai FUTURE; tidak ada mesin yang menjawab "siap/tidak + alasannya" | Rule engine, bukan AI |
| G6 | **EWS lintas dokumen/kontrak/temuan** — rule risk.ts belum meliputi: expiry dokumen, dokumen wajib hilang per fase, sisa waktu kontrak, laporan tanpa bukti, temuan overdue | Diperluas, satu keluarga rule |
| G7 | **Level progress terverifikasi** — `COUNTED_REPORT_STATUSES` satu level (dilaporkan); CIP menuntut pemisahan; OPEN_ISSUES menandainya "KEPUTUSAN" | Prompt §18 memutuskan: BEDAKAN. Diimplement sebagai parameter opsional, angka default TIDAK berubah (opsi 2 CIP) |
| G8 | **Evidence explorer lintas modul** | Galeri foto ada (`/foto`); register gabungan foto+dokumen per konteks temuan/inspeksi belum |
| G9 | **Register temuan sebagai produk laporan** (xlsx) | — |
| G10 | AI scope temuan (Ask MARLIN menjawab "lokasi dengan temuan kritis") | Adapter baru mengikuti pola `adapters.ts` |

## 3. PROPOSED INFORMATION ARCHITECTURE

Lihat `UX_INFORMATION_ARCHITECTURE.md`. Ringkas:

- Menu baru: **Temuan** (`/temuan`, semua role ber-`finding.view`),
  **Verifikasi** (`/verifikasi`, workspace Wakil PPK), **Perlu Tindakan**
  (`/perlu-tindakan`, EWS untuk manajemen + wakil), **Kesiapan** (`/kesiapan`,
  termin/PHO/FHO per paket).
- Workspace lokasi mendapat data temuan lewat papan `/temuan?lokasi=` (deep-link),
  bukan tab baru (tab lokasi sudah 9).
- Laporan harian `/lokasi/[slug]/harian/[date]` mendapat panel "Verifikasi
  Wakil PPK" bagi pemegang `report.verify_external`.

## 4. DATA MODEL CHANGES

Baru (semua `@@map` snake_case, uang tidak ada di sini):

- `Finding` + `FindingStatusHistory` (append-only, trigger DB) +
  `FindingClarification` + `FindingNote` (tindak lanjut).
- `Inspection` (draft→final).
- `EvidenceLink` — tautan bukti: tepat satu sumber (`photoId` ATAU `documentId`),
  minimal satu induk (`findingId`/`inspectionId`/`clarificationId`), CHECK
  constraint di DB; status verifikasi bukti per-tautan.
- `ReportVerification` — append-only; baris terakhir per laporan = status
  verifikasi eksternal terkini (`diverifikasi`/`perlu_klarifikasi`/`ditolak`).
- Enum: `FindingSource`, `FindingCategory`, `FindingStatus`,
  `InspectionStatus`, `ReportVerifStatus`, `EvidenceVerifStatus`.

TIDAK dibuat: model DocumentRequirement (pakai AdminMilestone), model
EWS/Alert (derived), kolom agregat apa pun.

## 5. ROLE & PERMISSION MATRIX (delta)

Capability baru → pemegang:

| Capability | Pemegang | Isi |
|---|---|---|
| `finding.view` | semua role ber-`VIEW_ALL` (termasuk wakil_ppk, exec_viewer) | lihat papan & detail temuan |
| `finding.create` | site_manager↑, wakil_ppk | mencatat temuan |
| `finding.respond` | site_manager↑ | tindak lanjut + jawab klarifikasi + ajukan verifikasi |
| `finding.verify` | wakil_ppk, program_director, super_admin | klarifikasi, verifikasi bukti, tutup, buka kembali |
| `inspection.manage` | wakil_ppk, program_director, super_admin | catat & finalkan inspeksi |
| `report.verify_external` | wakil_ppk, program_director, super_admin | verifikasi eksternal laporan harian |

Pemisahan tugas: pihak pelaksana (SM/PM/AM) TIDAK punya `finding.verify` —
yang menutup temuan bukan yang ditindak. `finding.respond` tidak dimiliki
wakil_ppk — pemeriksa tidak menindaklanjuti temuannya sendiri.

**Wakil PPK berubah dari read-only → verifikator** (supersede sebagian
DECISIONS 199; dicatat DECISIONS 426). Tetap: tanpa `ai.*`, tanpa `finance.*`,
tanpa menyentuh data pelaksana (laporan/RAB/dokumen), sesuai penugasan lokasi.

## 6. IMPLEMENTATION ROADMAP

1. Phase 3 — schema + migration + trigger append-only + authz + lifecycle.
2. Phase 4a — findings lib/actions/UI.
3. Phase 4b — verifikasi eksternal laporan + inspeksi + workspace `/verifikasi`.
4. Phase 4c — kesiapan termin/PHO/FHO (`lib/kesiapan/`) + `/kesiapan`.
5. Phase 4d — EWS (`lib/ews/`) + `/perlu-tindakan`.
6. Phase 4e — verifiedProgress param + register temuan xlsx + adapter AI temuan.
7. Phase 5 — tests + typecheck/lint/build + dokumen (DECISIONS append,
   PERMISSION_MATRIX regen, OPEN_ISSUES).

## 7. FILES TO MODIFY (inti)

- `prisma/schema.prisma` + migration baru.
- `src/lib/authz.ts` (+6 capability), `tests/unit/wakil-ppk.test.ts`,
  `tests/unit/authz.test.ts`, `docs/rebuild/PERMISSION_MATRIX.md` (regen).
- `src/lib/lifecycle.ts` (transisi + label + tone Finding/Inspection/ReportVerif).
- `src/lib/progress.ts` (param `statusLevel`, default tidak berubah).
- `src/components/shell/nav-config.ts` (menu baru).
- Baru: `src/lib/findings/`, `src/lib/inspections/`, `src/lib/verifikasi/`,
  `src/lib/kesiapan/`, `src/lib/ews/`, `src/lib/export/temuan-xlsx.ts`,
  halaman `/temuan`, `/verifikasi`, `/perlu-tindakan`, `/kesiapan`.
- `src/lib/ai-hub/adapters.ts` + `adapters-pagar.ts` (adapter temuan).
- Panel verifikasi eksternal di halaman harian.

## 8. RISKS

1. **Perubahan peran Wakil PPK** membalikkan DECISIONS 199 — dicatat eksplisit
   (DECISIONS 426); tes penjaga ditulis ulang jadi whitelist eksplisit.
2. **Level progress**: menampilkan angka terverifikasi di samping angka resmi
   bisa membingungkan bila label tidak tegas → label wajib
   "Progress Dilaporkan" vs "Progress Terverifikasi (internal)" per CIP.
3. **EWS false positive** di lokasi yang belum SPMK/di luar masa kontrak —
   rule wajib memakai pagar minggu-0 & masa kontrak yang sudah ada
   (`currentWeekNumber` = 0, DECISIONS 340).
4. Migrasi menambah tabel saja (tidak mengubah tabel lama) — risiko data rendah.
5. Scope besar; setiap phase di-commit terpisah supaya bisa direview/dibatalkan
   per bagian.

## 9. WHAT SHOULD NOT BE BUILT

- Sistem/aplikasi/microservice terpisah — semua di dalam MARLIN.
- Model `DocumentRequirement` baru (AdminMilestone sudah menjawabnya).
- Penghidupan kembali model `Alert` / penyimpanan hasil EWS.
- Formula progress baru di mana pun di luar `progress.ts` (verifiedProgress =
  parameter status di formula YANG SAMA).
- Duplikasi berkas evidence (EvidenceLink menunjuk Photo/Document existing).
- AI yang menentukan status readiness/warning (semua rule deterministik).
- Tombol tanpa backend (kirim WA/Drive untuk artefak baru menyusul bila
  diminta — tidak dipasang tombol palsu).
- PWA/offline baru, PHO parsial (tetap FUTURE di OPEN_ISSUES).

## 10. SCREENS baru / dirombak

| Screen | Status | Isi |
|---|---|---|
| `/temuan` | BARU | Papan temuan lintas lokasi: KPI (terbuka, kritis, lewat tenggat, menunggu verifikasi, dibuka kembali), filter, kartu |
| `/temuan/[id]` | BARU | Detail: linimasa status, klarifikasi Q/A, tindak lanjut, bukti (foto/dokumen), aksi sesuai peran |
| `/verifikasi` | BARU | Workspace Wakil PPK: antrean laporan belum diverifikasi (lokasi penugasan), inspeksi, temuan yang menunggu verifikasi |
| `/verifikasi/inspeksi/baru`, `/verifikasi/inspeksi/[id]` | BARU | Catat inspeksi, tautkan bukti, angkat temuan, finalkan |
| `/perlu-tindakan` | BARU | Papan EWS: Kritis/Tinggi/Sedang, tiap kartu = sumber+alasan+aksi yang disarankan+deep-link |
| `/kesiapan` | BARU | Kesiapan termin/PHO/FHO per paket: Siap / Siap dengan catatan / Belum siap + alasan spesifik |
| `/lokasi/[slug]/harian/[date]` | DIROMBAK ringan | + panel Verifikasi Wakil PPK (status + riwayat + form) |
| Beranda | DIROMBAK ringan | + kartu ringkas EWS & temuan bagi pemegang capability |
