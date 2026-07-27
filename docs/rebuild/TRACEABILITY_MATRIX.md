# TRACEABILITY MATRIX — MARLIN Rebuild

> **ARSIP — penelusuran fitur lama → baru saat rebuild.**
> Bukan spesifikasi berjalan. Kondisi terkini ada di `PROJECT.md`
> (arsitektur & formula), `docs/OPEN_ISSUES.md` (yang masih terbuka), dan
> `docs/DECISIONS.md` (riwayat keputusan).


Status: `✅ selesai` / `🔶 sebagian` / `⏳ direncanakan` / `⏸ ditunda (dicatat)`. Diupdate setiap slice.

| # | Kebutuhan | Sumber | Entitas | Service/Lib | UI | Role/Capability | Test | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | Lifecycle paket tunggal prospek→selesai | Prompt §15.1,16.3 | Package, PackageStageHistory | lib/package | /paket, workspace | package.*, prospect.manage | unit lifecycle, E2E-1 | ✅ |
| R2 | 1 kontrak banyak lokasi | Prompt §16.4; DECISIONS 016 | Contract, Location | lib/package | workspace paket tab Lokasi | contract.manage | integration | ✅ |
| R3 | Konversi prospek→kontrak idempotent | Prompt §20 | Contract uniq(packageId) | convertPackage action | workspace paket | prospect.manage | integration + E2E-1 | ✅ |
| R4 | Adendum nilai/waktu + histori | Prompt §20 | ContractAmendment | lib/contract | tab Kontrak & Adendum | amendment.manage | E2E-5 | ✅ |
| R5 | RAB import preview→validasi→aktif | Prompt §24 | RabRevision, RabNode | lib/rab (parser lama) | tab Rencana & RAB | rab.manage | unit parser, E2E-2 | ✅ |
| R6 | Revisi RAB + lineage carry-over | DECISIONS 023 | RabNode.lineageKey | lib/rab | riwayat revisi | rab.manage | integration | ✅ |
| R7 | Baseline kurva-S versioned + edit | Prompt §24; DECISIONS 027 | Baseline, BaselinePoint | lib/scurve | tab Rencana & RAB | baseline.manage | unit paritas | ✅ |
| R8 | Weekly plan advisory | Prompt §24 | WeeklyPlan(+Item) | lib/plan | tab Rencana & RAB | weekly_plan.manage | E2E-2 | ✅ |
| R9 | Laporan harian TUNGGAL + workflow | Prompt §15.3,22 | DailyReport(+Item/Worker/Material/Equipment/StatusHistory) | lib/daily-report | /hari-ini + workspace harian | daily_report.* | E2E-3,4 | ✅ |
| R10 | Progress berbasis volume, % derived | PROJECT; prompt §16.6 | derived | lib/progress (formula lama) | tab Progress, Command Center | progress.view | unit formula | ✅ |
| R11 | Anti-double-input di DB | #56 | uniq(reportId,rabNodeId)+uniq(loc,date) | — | — | — | integration | ✅ |
| R12 | Koreksi berversi, angka tak dobel | Prompt §22 | StatusHistory + audit | lib/daily-report | workspace harian | daily_report.review | E2E-4 | ✅ |
| R13 | KKP harian/mingguan/bulanan format resmi | Contoh KKP user; DECISIONS 037/038/045 | finalSnapshot + calc live | lib/report (formula lama) | tab Laporan + /cetak | report.export | E2E-3 + visual | ✅ |
| R14 | Keuangan transaction-based + formula | Prompt §15.4,25 | BudgetLine..Disbursement | lib/finance/calc | /keuangan + tab Keuangan | finance.* | unit calc, E2E-6 | ✅ |
| R15 | Milestone workflow + dokumen ≠ auto-selesai | Prompt §26 | AdminMilestone | lib/milestone | tab Dokumen & Kepatuhan | compliance.manage | E2E-7 | ✅ |
| R16 | Document Center terhubung entitas | Prompt §26 | Document (FK nyata) | lib/documents | /dokumen | document.* | integration | ✅ |
| R17 | Capability authz + re-check server | Prompt §29 | Session, mapping | lib/authz | semua | — | unit + E2E-8 | ✅ |
| R18 | Audit trail mutasi | Prompt §2,29 | AuditLog | lib/audit | /sistem | audit.view | integration | ✅ |
| R19 | Session revocable + rate limit + first-login | Prompt §29 | Session, LoginAttempt, mustChangePassword | lib/auth | /masuk, /ganti-password | — | integration | ✅ |
| R20 | R2 validasi env + pipeline upload + diagnostik | Prompt §32 | Photo, Document | lib/r2 | /sistem | system.manage | unit env, E2E-9 | ✅ |
| R21 | AG Grid Community semua daftar besar | Prompt §11 | — | MarlinGrid | semua list | — | visual | ✅ |
| R22 | Dockerfile + Railway tanpa Nixpacks | Prompt §13 | — | Dockerfile, railway.json | — | — | DOCKER_VERIFICATION | ✅ |
| R23 | CI lengkap | Prompt §14 | — | .github/workflows | — | — | CI run | ✅ |
| R24 | Mobile Hari Ini + draft offline + idempotent sync | Prompt §23 | draft lokal + idempotency key | lib/daily-report | /hari-ini | daily_report.create | E2E-3 | 🔶 (draft lokal + idempoten; SW/installable ditunda) |
| R25 | PHO/pemeliharaan/FHO | Prompt §16.10 | LocationStatus + AdminMilestone | lib/milestone | workspace | location.manage | — | 🔶 (status PHO/pemeliharaan/FHO + milestone ada; alur defect list dasar via Issue) |
| R26 | Exception-first Command Center, KPI klik-tembus | Prompt §19 | derived | lib/dashboard | / | portfolio.view | visual | ✅ |
| R27 | Peta lokasi | fitur lama | Location (gps) | lib/peta | /peta (leaflet murni BSD) | location.view | visual + Playwright | ✅ |
| R28 | PWA installable + service worker penuh | Prompt §23 | — | — | — | — | — | ⏸ (draft lokal + idempotensi dulu) |
