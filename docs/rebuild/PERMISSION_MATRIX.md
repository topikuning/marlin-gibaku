# PERMISSION MATRIX — MARLIN Rebuild

Model: **capability-based**. Role → set capability (konstanta di `src/lib/authz.ts`). Frontend hanya menyembunyikan menu; **setiap Server Action / Route Handler wajib otorisasi ulang** via `requireCapability()` + scope check (`requireLocationAccess()`).

Scope: `super_admin`, `program_director`, `exec_viewer` = cross-location. Lainnya dibatasi `LocationAssignment` (dan paket yang memuat lokasi tsb).

| Capability | super_admin | program_director | regional_manager | project_manager | site_manager | field_supervisor | exec_viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| portfolio.view | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| package.view | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| package.create / package.edit | ✓ | ✓ | — | — | — | — | — |
| prospect.manage (tender, konversi) | ✓ | ✓ | — | — | — | — | — |
| contract.manage | ✓ | ✓ | — | — | — | — | — |
| amendment.manage | ✓ | ✓ | — | — | — | — | — |
| location.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| location.manage (status, tim) | ✓ | ✓ | ✓ | ✓ | — | — | — |
| rab.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rab.manage (import, revisi) | ✓ | ✓ | — | ✓ | — | — | — |
| baseline.manage | ✓ | ✓ | — | ✓ | — | — | — |
| weekly_plan.manage | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| daily_report.create | ✓ | ✓ | — | — | ✓ | ✓ | — |
| daily_report.review (verifikasi/koreksi) | ✓ | ✓ | — | ✓ | ✓ | — | — |
| daily_report.finalize (KKP final) | ✓ | ✓ | — | — | ✓ | — | — |
| progress.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| issue.manage (kendala, recovery) | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| finance.view | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| finance.input (transaksi) | ✓ | ✓ | — | ✓ | ✓* | — | — |
| finance.approve | ✓ | ✓ | ✓ | — | — | — | — |
| document.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| document.upload | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| document.verify / compliance.manage | ✓ | ✓ | ✓ | ✓ | — | — | — |
| report.export | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| user.manage | ✓ | ✓ | — | — | — | — | — |
| system.manage (diagnostik, setting, reset dev) | ✓ | — | — | — | — | — | — |
| audit.view | ✓ | ✓ | — | — | — | — | — |

\* site_manager hanya input pengeluaran/kasbon lokasi sendiri, tanpa approve.

Perbaikan dari sistem lama: `canManageUsers` tidak lagi dipakai sebagai gate keuangan/kontrak/RAB/kurva-S (bug semantik lama). `user.manage` ≠ `finance.approve` ≠ `contract.manage`.

Keamanan tambahan:
- Session DB revocable (deactivate user = sesi mati; tokenVersion bump = force-logout).
- `mustChangePassword` saat first-login / reset.
- Rate limit login (per identifier+IP, window di DB).
- Audit log tiap mutasi (siapa, kapan, apa, payload ringkas).
- Aksi destruktif (reset data dev) = `system.manage` + konfirmasi ketik + APP_ENV != production.
- RLS: TIDAK diklaim. Otorisasi di application layer, diuji integration test. (RLS dicatat sebagai kandidat hardening berikutnya.)
