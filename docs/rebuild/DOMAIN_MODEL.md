# DOMAIN MODEL TARGET — MARLIN Rebuild

Single source untuk schema baru. Konsolidasi dari temuan `DATA_MODEL_AUDIT.md`.

## Prinsip

- Uang = `BigInt` rupiah integer. Volume = `Decimal(15,3)`. Waktu = `Timestamptz`, logika bisnis `Asia/Jakarta`.
- Status canonical disimpan + histori transisi; status display boleh derived (dari dokumen) tapi tidak pernah jadi sumber kebenaran ganda.
- Angka agregat TIDAK disimpan untuk diedit — dihitung dari transaksi. Snapshot hanya untuk laporan final (immutable).
- Semua FK nyata (tidak ada kolom uuid menggantung).
- Append-only untuk: audit log, histori status, transisi laporan, adendum.

## Hierarki inti

```
Organization
└─ Package (paket — spine lifecycle: prospek → tender → kontrak → pelaksanaan → serah terima → selesai | batal)
   ├─ PackageStageHistory (append-only)
   ├─ Contract (0..1 per package; nomor, nilai, tanggal, termin, uang muka, retensi, PPN%)
   │  └─ ContractAmendment (adendum, append-only)
   ├─ Location (0..N; pre-kontrak = lokasi target, post-konversi = unit pelaksanaan)
   └─ Document (bukti per tahap)
```

**Konsolidasi lifecycle** (menggantikan ProspekStage + ProcurementStage + DocumentStage):
- `PackageStage` (canonical, disimpan, ber-histori): `prospek`, `tender`, `penetapan`, `kontrak`, `pelaksanaan`, `serah_terima`, `selesai`, `batal`.
- Detail administrasi dalam tiap stage = **AdminMilestone** (checklist KKP 40-item) yang statusnya bisa auto-suggest dari upload dokumen tapi butuh verifikasi untuk milestone kritis. Upload dokumen ≠ otomatis milestone selesai.
- `LocationStatus` (fisik, orthogonal): `persiapan`, `berjalan`, `terhenti`, `selesai`, `pho`, `pemeliharaan`, `fho`, `batal` + histori.

## Model per domain

### Identitas & akses
- `User` — username/email uniq, passwordHash (argon2id), role, isActive, **mustChangePassword**, **tokenVersion** (revocation).
- `Session` — DB-backed: id (token hash), userId, expiresAt, revokedAt, ip, userAgent. Logout/deactivate = revoke.
- `LocationAssignment` — user↔location (scoped access), uniq(userId, locationId) aktif.
- Role→capability mapping di kode (`src/lib/authz.ts`), bukan DB. Capability list lihat `PERMISSION_MATRIX.md`.
- DIHAPUS: Device, OtpCode, SyncQueue (offline pakai idempotency key di action + draft lokal client).

### Paket & kontrak
- `Package` — name, packageNumber?, ownerAgency (KKP), hpsValue BigInt, stage, kanwil/province?, note, cancelReason?, createdBy. Prospek = Package stage `prospek..penetapan`.
- `Vendor` (rename Contractor) — name uniq/org, npwp?, kontak.
- `Contract` — packageId uniq (1:1), vendorId, contractNumber uniq, contractValue, ppnPercent Decimal (default dari setting, tidak hardcode), signedDate, startDate, endDate, advancePercent?, retentionPercent?, paymentTerms (json ringkas)?. Nilai berjalan = contractValue + Σ amendment.valueDelta (derived).
- `ContractAmendment` — append-only: ccoNumber, valueDelta, endDateDelta hari, effectiveDate, reason; relasi ke RabRevision & Baseline yang dihasilkan.
- `Location` — packageId (bukan lagi via contract saja; kontrak diakses via package), name, slug uniq, village/regency/province, gps, status + `LocationStatusHistory`. **Tanpa** kolom keuangan snapshot, tanpa procurementStage, tanpa deviationCause/recoveryPlan.
- Konversi prospek→kontrak = idempotent: satu transaksi membuat Contract + mengaktifkan Location target + set stage `kontrak`; guard unique(packageId) di Contract.

### RAB & baseline
- `RabRevision` — per location: revisionNo uniq/loc, source (`hps_awal`|`adendum`), amendmentId?, status (`draft`|`aktif`|`digantikan`), totalValue, sourceDocumentId? (FK nyata), createdBy, supersededAt.
- `RabNode` — **satu tabel pohon** (mengganti RabCategory/RabSubcategory/RabItem triple-parent): revisionId, parentId?, kind (`kategori`|`sub`|`grup`|`item`), code, name, volume?, unit?, unitPrice Decimal?, amount BigInt (nilai node; utk item = round(volume×unitPrice), utk grup = Σ anak), lineageKey (path stabil utk carry-over lintas revisi), sortOrder. Uniq(revisionId, path). Query 1 revisi = 1 query; tree dibangun in-memory; cocok utk flattened AG Grid.
- `Baseline` (rename ScurvePlan) — per location: baselineNo, source (`auto`|`adendum`|`manual`), status, rabRevisionId?, contractDays, createdBy + `BaselinePoint` (weekNumber, plannedPct cumulative). Histori dipertahankan.
- `WeeklyPlan` + `WeeklyPlanItem` — advisory; target volume per rab node + priority + PIC + catatan material/alat.
- Formula progress/bobot/kurva-S dipertahankan verbatim dari implementasi lama (sudah diverifikasi) — lihat "FORMULA" di `DATA_MODEL_AUDIT.md`; agregasi realisasi by `lineageKey` pada revisi aktif.

### Pelaksanaan harian (SATU entitas)
- `DailyReport` — uniq(locationId, reportDate). Status: `draft` → `dikirim` → `perlu_koreksi` → (`dikirim`…) → `disetujui` → `final`. Kolom: weather, workStart/End, notes, submittedBy/At, verifiedBy/At, finalizedBy/At, finalSnapshot Json? (KKP immutable saat final), + `DailyReportStatusHistory` (append-only: from,to,by,reason).
- `DailyReportItem` — uniq(reportId, rabNodeLineageKey): volume hari itu, valueDone (BigInt, dihitung server), notes; foto via `Photo.reportItemId`. Kumulatif = derived (Σ item pada report status ≥ dikirim, exclude report `perlu_koreksi` items yang direvisi — koreksi mengedit item pada report yang sama, histori via status history + audit log).
- `DailyReportWorker` (role KKP 14 jenis, count), `DailyReportMaterial`, `DailyReportEquipment` — anak langsung DailyReport (menggantikan DailyLog*).
- Guard integritas: uniq DB (reportId, rabNodeId); volume kumulatif ≤ volume RAB (cek server, toleransi 1e-6); anti-double-submit via idempotency (uniq(locationId,reportDate) + status machine); laporan `perlu_koreksi`/draft memblok pengiriman laporan tanggal baru utk item yang sama? → TIDAK dipindah ke level report: satu lokasi hanya boleh punya ≤1 report belum-tuntas (partial unique index status in draft/dikirim/perlu_koreksi per lokasi **per tanggal** sudah dijamin uniq(loc,date); lock lama per-item digantikan aturan "item hanya bisa dilaporkan lewat report harian tanggal itu").
- `Photo` — reportItemId? / reportId?, r2Key uniq, sha256 uniq (dedup), thumbnailKey, EXIF, verification.

### Isu & pemulihan
- `Issue` — locationId, title, description, severity, status (`terbuka`|`ditangani`|`selesai`), raisedBy, reportId? (dari kendala harian).
- `RecoveryAction` — issueId, description, picUserId, dueDate, status, + `RecoveryUpdate` (progress log).

### Keuangan (transaction-based)
- `BudgetLine` — locationId, category (CostCategory), amount, revisionNote; perubahan = row baru berstatus aktif + histori (approval `budget.change`).
- `Commitment` — locationId, vendorId?, type (`po`|`kontrak_vendor`|`kasbon`), number, description, amount, dueDate?, status (`draft`|`diajukan`|`disetujui`|`ditolak`|`selesai`|`batal`), budget category, createdBy, approvedBy.
- `Expense` (realisasi) — locationId, commitmentId?, category, amount, txDate, description, evidenceDocumentId?, createdBy, status (`diajukan`|`disetujui`|`ditolak`); kasbon settlement = Expense yang mengunci commitment kasbon.
- `Invoice` (tagihan vendor / payable) — commitmentId?, locationId, number, amount, invoiceDate, dueDate, status (`diajukan`|`disetujui`|`dibayar_sebagian`|`lunas`|`ditolak`).
- `PaymentOut` — invoiceId, amount, paidDate, evidence.
- `OwnerBilling` (tagihan ke KKP) — contractId, terminNo, amount, retentionHeld, status (`draft`|`diajukan`|`disetujui`|`cair_sebagian`|`cair`), billedDate.
- `Disbursement` (pencairan masuk) — ownerBillingId, amount, receivedDate.
- Semua formulir agregat derived (satu modul `src/lib/finance/calc.ts`):
  - `availableBudget = Σ budget − Σ expense.disetujui − Σ commitment.disetujui yang belum terealisasi`
  - `outstandingPayable = Σ invoice.disetujui − Σ paymentOut`
  - `unbilledWork = nilaiTerpasangTerverifikasi − Σ ownerBilling.diajukan+`
  - `cashRequirement = komitmen jatuh tempo + forecast biaya − kas tersedia − pencairan terjadwal`
- DIHAPUS: `Location.invoicedValue/paidValue/spentValue/budgetCap`, `CostEntry`.

### Administrasi & dokumen
- `AdminMilestone` — packageId, locationId?, templateKey (dari KKP_ADMIN_FLOW), name, phase, picUserId?, dueDate?, status (`belum_dimulai`|`berjalan`|`menunggu_pihak_lain`|`perlu_perbaikan`|`selesai`|`tidak_berlaku`|`terlambat` derived), completedAt, verifiedBy?, note, requiresVerification bool.
- `Document` — FK nyata: packageId?, contractId?, locationId?, amendmentId?, milestoneId?, reportId? + stage/type/metadata/r2Key/sha256/version chain (supersedesId). Duplicate detection by sha256/org.
- PHO/FHO = AdminMilestone fase serah_terima + LocationStatus transitions (pho → pemeliharaan → fho).

### Sistem
- `AuditLog` — append-only, DIISI oleh helper `audit()` di semua server action mutasi.
- `Alert` — dipertahankan (generated by evaluasi harian, bukan tabel mati).
- `AppSetting` — key/value effective-dated (ppn_percent default, dsb).

## Model DIHAPUS dari schema lama

`Prospek`, `ProspekLokasi` (→ Package/Location), `Device`, `OtpCode`, `SyncQueue`, `ScheduledMilestone`, `WeeklyReport`, `MonthlyReport` (laporan dihitung live + snapshot final di DailyReport.finalSnapshot / export), `DailyLog`+`DailyLogWorker/Material/Equipment` (→ DailyReport*), `CostEntry` (→ Expense), `DeviationNote` (→ Issue/RecoveryAction), `RabCategory`/`RabSubcategory`/`RabItem` (→ RabNode), `BudgetLine` lama (→ BudgetLine transaksional), `ContractAmendment.attachmentUrl` (→ Document FK).

## Migrasi

Belum production → migration development lama dihapus, dibuat **baseline migration baru** dari schema target, database development di-reset, seed baru deterministik (lihat REBUILD_PLAN §seed).
