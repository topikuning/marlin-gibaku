# CURRENT STATE AUDIT — MARLIN (pra-rebuild, per commit b6e77af)

Detail per area: `SCREEN_AND_ROUTE_INVENTORY.md` (UI/route), `DATA_MODEL_AUDIT.md` (schema/logic), `DEPLOYMENT_ARCHITECTURE.md` (infra). Dokumen ini = ringkasan + keputusan per modul.

## Ringkasan kondisi

Aplikasi Next 15 + Prisma 6 + next-auth v5 **beta** + Tailwind 4 **beta**, ~30 route, 7 role, seed 7 lokasi riil (11k RAB item). Fungsional untuk demo, tetapi: lifecycle terpecah 4 taksonomi, laporan harian terpecah 2 model data + 4 menu, keuangan snapshot manual, permission memakai gate `canManageUsers` untuk keuangan/kontrak/RAB, **0 test**, **tanpa CI**, deploy Nixpacks (tanpa Dockerfile), audit log tidak pernah ditulis, tanpa rate limit, session JWT tidak bisa direvoke.

## Masalah utama (yang mendorong rebuild)

1. **Lifecycle tumpang tindih** — ProspekStage (7), ProcurementStage (8, kolom mati), DocumentStage (9), LocationStatus (6). Stage otoritatif ternyata derived dari dokumen (`deriveDocStage`) di dua tempat berbeda.
2. **Laporan harian terpecah** — volume (`DailyReportItem`, menu Lapor/Laporan) vs enrichment KKP (`DailyLog*`, menu Harian) digabung hanya saat render. SM pindah 3–4 menu untuk satu pekerjaan.
3. **Integritas** — lock anti-double-input hanya app-level (race); `reportDate` di-stamp tanggal approval (bukan tanggal kerja); chain koreksi `supersedesId` tidak pernah ditulis; `DailyReportItem` mutable padahal parent append-only; 8 kolom uuid tanpa FK.
4. **Keuangan snapshot** — `Location.invoicedValue/paidValue/spentValue/budgetCap` diedit manual; `BudgetLine` dan `CostEntry` tidak pernah direkonsiliasi; PPN 11% hanya diperhitungkan di 1 halaman (finance.ts mengabaikannya).
5. **Permission** — `canManageUsers` (super_admin+program_director) jadi gate kurva-S, RAB import, kontrak, keuangan. PM tidak bisa apa-apa yang seharusnya bisa.
6. **Kinerja** — `getFinanceRows` ±40 query utk 7 lokasi (per-lokasi progress+plan); tree walk BFS per-level; `getActiveLineages` mengulang full tree walk; `serializeBigInt` JSON round-trip.
7. **Teknologi** — 2 dependency beta di production, range `^` semua, tanpa pin; tanpa standalone output; README/RAILWAY.md basi.

## Keputusan per modul

| Modul | Kondisi | Keputusan |
|---|---|---|
| Auth (next-auth beta, JWT) | login jalan; tanpa revocation/rate-limit/authz middleware | **Tulis ulang**: session DB custom + capability |
| Roles/access | boolean kasar, salah semantik | **Tulis ulang**: capability matrix |
| Prospek + konversi | koheren, doc-driven stage | **Gabungkan** ke Package lifecycle |
| Kontrak/adendum | CRUD dasar OK; 2 jalur create Contract | **Refactor** ke workspace paket; adendum append-only dipertahankan |
| Lokasi + workspace tab | pola tab bagus | **Refactor** ke IA baru (8 tab) |
| RAB import (parser xlsx) | teruji data riil; struktur triple-parent canggung | **Parser dipakai ulang** (port ke RabNode); tree → 1 tabel |
| Revisi RAB + lineage | model snapshot+lineage benar | **Pertahankan semantik**, ganti lineageId → lineageKey path-stable |
| Kurva-S (auto smoothstep + per-trade) | formula diverifikasi identik dgn Python | **Pakai ulang** formula verbatim → Baseline |
| Progress/bobot/prestasi | formula KKP benar | **Pakai ulang** verbatim, satu calculation layer |
| Lapor/Laporan/Harian/KKP | terpecah (lihat #2) | **Tulis ulang** jadi satu DailyReport |
| KKP daily/period render | layout benar; period = monolit 350 baris + S-curve duplikat | Daily **refactor**, period **tulis ulang** |
| Keuangan | snapshot manual | **Tulis ulang** transaction-based |
| Dokumen + KKP_ADMIN_FLOW (40 item) | konsep bagus, milestone hanya derived | **Refactor**: AdminMilestone workflow + Document Center |
| Peta (Leaflet) | jalan, disukai | **Defer** (di luar scope inti rebuild; dicatat) |
| Pengguna | CRUD dasar | **Refactor** + mustChangePassword + penugasan |
| Diagnostik/reset | TRUNCATE raw hardcoded list | **Tulis ulang**: guard APP_ENV + capability |
| DataGrid (TanStack) | primitive terbaik lama | **Ganti** AG Grid Community (mandat) |
| PhotoGallery / ScurveChart / cetak pattern | solid, reusable | **Pakai ulang** (adaptasi) |
| Seed (7 lokasi riil) | data berharga; item UUID regenerate tiap run | **Pakai ulang data**, seed baru deterministik |
| WeeklyReport/MonthlyReport/ScheduledMilestone/Device/OtpCode/SyncQueue | tabel mati | **Hapus** |

## Fungsi yang dipertahankan verbatim (sudah diverifikasi)

- Parser HPS (`hps-parser.ts`) — hierarchy inference + sumLeaves.
- Formula kurva-S smoothstep + CATEGORY_PHASE + per-trade scheduling (identik `scripts/scurve.py`).
- Formula bobot/prestasi KKP (`periodic-report.ts`).
- `valueDone = round(volume × unitPrice)`; agregasi realisasi by lineage pada revisi aktif; guard kumulatif ≤ volume RAB.
- PPN: RAB pre-PPN, kontrak incl-PPN, mismatch warning toleransi 0.1% — dijadikan konsisten di SEMUA perhitungan (perbaikan bug finance.ts).
- Data seed 7 lokasi (seed-data/*.json) + `scripts/parse_hps.py`.
