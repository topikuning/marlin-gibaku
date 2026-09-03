# PERMISSION MATRIX

> **DIBANGKITKAN OTOMATIS dari `src/lib/authz.ts` — jangan diedit tangan.**
> Perbarui dengan `pnpm docs:permission`.
> `tests/unit/permission-matrix-doc.test.ts` gagal bila file ini tertinggal.

Model: **capability-based**. Role → set capability (konstanta di `src/lib/authz.ts`).
Frontend hanya menyembunyikan menu; **setiap Server Action / Route Handler wajib
otorisasi ulang** via `requireCapability()` + scope check (`requireLocationAccess()`).

Scope lokasi: `super_admin`, `program_director` = lintas lokasi
(semua lokasi ORGANISASI-nya, tanpa penugasan). Role lain — termasuk
`exec_viewer` sejak DECISIONS 190 — dibatasi `LocationAssignment` (dan paket yang
memuat lokasi tersebut); tanpa penugasan berarti NOL lokasi, bukan semuanya.

Jumlah capability: **65**.

| Capability | super_admin | program_director | regional_manager | project_manager | site_manager | field_supervisor | exec_viewer | wakil_ppk |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `portfolio.view` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ |
| `package.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| `package.create` | ✓ | ✓ | – | – | – | – | – | – |
| `package.edit` | ✓ | ✓ | – | – | – | – | – | – |
| `package.bypass` | ✓ | ✓ | – | – | – | – | – | – |
| `prospect.manage` | ✓ | ✓ | – | – | – | – | – | – |
| `contract.manage` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `contract.edit` | ✓ | – | – | – | – | – | – | – |
| `contract.week_mode` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `amendment.manage` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `location.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `location.manage` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `location.correct` | ✓ | – | – | – | – | – | – | – |
| `location.signer` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `rab.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `rab.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `rapl.view` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – |
| `rapl.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `baseline.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `weekly_plan.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `daily_report.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `daily_report.review` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `daily_report.finalize` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `daily_report.unfinalize` | ✓ | – | – | – | – | – | – | – |
| `daily_report.move_date` | ✓ | – | – | – | – | – | – | – |
| `field_activity.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `photo.quick` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `photo.restamp` | ✓ | ✓ | – | – | – | – | – | – |
| `photo.archive_purge` | ✓ | ✓ | – | – | – | – | – | – |
| `wa.configure` | ✓ | – | – | – | – | – | – | – |
| `gdrive.open_folder` | ✓ | – | – | – | – | – | – | – |
| `progress.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `issue.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `finding.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `finding.create` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| `finding.respond` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `finding.verify` | ✓ | ✓ | – | – | – | – | – | ✓ |
| `inspection.manage` | ✓ | ✓ | – | – | – | – | – | ✓ |
| `report.verify_external` | ✓ | ✓ | – | – | – | – | – | ✓ |
| `finance.view` | ✓ | – | – | – | – | – | – | – |
| `finance.input` | ✓ | – | – | – | – | – | – | – |
| `finance.approve` | ✓ | – | – | – | – | – | – | – |
| `document.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `document.upload` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `letter.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `letter.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `letter.void` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `document.verify` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `document.edit` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `document.void` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `document.delete` | ✓ | – | – | – | – | – | – | – |
| `compliance.manage` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `report.export` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| `wa.chat` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `contact.view_all` | ✓ | – | – | – | – | – | – | – |
| `ai.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `ai.generate` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `ai.ask` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `ai.report_review` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `ai.report_approve` | ✓ | ✓ | ✓ | – | – | – | – | – |
| `ai.report_send` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `user.manage` | ✓ | ✓ | – | – | – | – | – | – |
| `user.create` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `system.manage` | ✓ | – | – | – | – | – | – | – |
| `audit.view` | ✓ | ✓ | – | – | – | – | – | – |

## Capability yang HANYA super_admin

- `contract.edit`
- `location.correct`
- `daily_report.unfinalize`
- `daily_report.move_date`
- `wa.configure`
- `gdrive.open_folder`
- `finance.view`
- `finance.input`
- `finance.approve`
- `document.delete`
- `contact.view_all`
- `system.manage`

Alasan pembatasannya ditulis sebagai komentar di `src/lib/authz.ts`.

## Hierarki pembuatan akun

`user.create` dibatasi lagi oleh `creatableRoles(role)` — seorang user hanya
boleh membuat akun dengan peran DI BAWAHnya. Lihat `src/lib/authz.ts`.
