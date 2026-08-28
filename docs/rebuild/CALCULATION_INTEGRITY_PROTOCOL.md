# MARLIN — CALCULATION INTEGRITY PROTOCOL

> Protokol wajib untuk setiap pekerjaan yang menyentuh angka. Disimpan di repo
> supaya auditor/agen berikutnya menunjuk file yang benar-benar ada
> (audit 2026-07-27, H3).
>
> **Tabel "Calculation contract" di bawah sudah DIKOREKSI** terhadap kode
> berjalan. Versi awal protokol ini masih memuat `realizedValue = Σ valueDone`
> yang sudah tidak berlaku sejak DECISIONS 151 — kalau dibiarkan, pembaca
> berikutnya akan "memperbaiki" kode agar cocok dengan dokumen yang salah.

Gunakan protokol ini untuk setiap pekerjaan yang menyentuh progress, deviasi, kurva-S, laporan mingguan/bulanan, dashboard, PDF, Excel, AI report, revisi RAB/adendum, atau keuangan yang memakai nilai terpasang.

## Aturan mutlak

1. `PROJECT.md` adalah source of truth.
2. Semua angka progress harus berasal dari calculation layer canonical.
3. UI, PDF, Excel, WhatsApp, dashboard, dan AI dilarang menghitung ulang.
4. Jangan menebak business rule.
5. Bila dokumen, kode, dan test berbeda, STOP dan laporkan konflik.
6. Jangan menyatakan benar hanya karena typecheck/build hijau. Wajib ada fixture, rekonsiliasi, dan proof angka.

## File wajib dibaca sebelum coding

- `PROJECT.md` — arsitektur, domain model, dan **daftar tunggal calculation
  layer kanonik** (§3, lima berkas)
- `docs/DECISIONS.md` — riwayat keputusan angka (051/151/152/203/426/460)
- `docs/rebuild/TEST_PLAN.md`

> **JANGAN** memakai `docs/rebuild/DATA_MODEL_AUDIT.md` sebagai acuan. Dokumen
> itu ARSIP — schema & formula sistem LAMA (`b6e77af`), dan sampai audit
> 2026-08-28 protokol ini justru mewajibkannya. Membacanya sebagai spesifikasi
> berjalan adalah persis mode kegagalan yang diperingatkan di pembukaan
> protokol ini: "memperbaiki" kode agar cocok dengan dokumen yang salah.
> Ia boleh dibuka HANYA untuk memahami sejarah.
- `src/lib/progress.ts`
- `src/lib/periodic-report.ts`
- `src/lib/scurve/*`
- `src/lib/money.ts`
- `src/lib/lifecycle.ts`
- schema Prisma RAB/Baseline/DailyReport/DailyReportItem
- seluruh consumer angka yang akan diubah
- seluruh test terkait

Tulis daftar file dan fungsi yang dibaca sebelum mulai coding.

## Calculation contract wajib

Buat tabel sebelum implementasi:

Isi dari kondisi kode nyata, bukan asumsi. Kondisi terkini (per DECISIONS 152):

| Metric | Formula canonical | Source function | Counted status | Date semantics | Rounding | Revision rule |
|---|---|---|---|---|---|---|
| `grandTotal` | Σ `amount` node `kategori` revisi aktif | `progress.ts` | n/a | revisi aktif | BigInt eksak | active only |
| `realizedValue` | Σ `GREATEST(0, LEAST(1, Σvol/volRAB)) × amount` | `progress.ts` (raw SQL) | dikirim+disetujui+final | **tidak ada as-of** (M5) | `::bigint` | active lineage |
| `realizedPct` | `realizedValue / grandTotal × 100` | `money.pct` | ikut realizedValue | ikut realizedValue | float, dirounding di UI | active revision |
| `prestasiPct` | `min(100, max(0, vol/volK × 100))` | `progress-calc.ts` | dari caller | dari caller | float | active revision |
| `prestasi ini` | `prestasiSd − prestasiLalu` — **diturunkan** | `progress-calc.ts` | dari caller | periode | float | active revision |
| `bobot item` | `amount / grandTotal × 100` | `progress-calc.ts` | n/a | revisi aktif | float | active revision |
| `planPct` | baseline point minggu terpilih | `progress.ts` | n/a | minggu berjalan (jam dinding) | float | active baseline |
| `deviation` | `actual − plan` | `progress.ts` | sama dgn actual | sama | percentage points | same baseline |
| `valueDone` | `round(volume × hargaSatuan)` | `money.ts` | per item laporan | **beku saat lapor** | `Math.round` | **bukan basis agregat mana pun** |
| PPN | `preTax × round(pct×100) / 10000`, **dibulatkan** | `money.ts` | n/a | n/a | half-up, simetris utk negatif | n/a |

Catatan penting yang mudah terlewat:

- `realizedValue` **bukan** Σ `valueDone`. Kolom `valueDone` dibekukan memakai
  harga satuan revisi yang aktif saat laporan dibuat; memakainya sebagai basis
  membuat dashboard melenceng dari blanko KKP setiap kali ada adendum harga.
- Batas 100% dipasang di KUMULATIF saja. Kolom periode diturunkan dengan
  pengurangan supaya "lalu + ini = s/d" selalu benar.
- Rumus di SQL (`progress.ts`) dan di TS (`progress-calc.ts`) **wajib sepadan**,
  termasuk batas bawah. Paritasnya diuji di
  `tests/integration/periodic-report.test.ts`.

## Status progress harus dibedakan

Jangan memakai label generik `Realisasi` tanpa menyebut levelnya.

- `reportedProgress`: `dikirim + disetujui + final`
- `verifiedProgress`: `disetujui + final`
- `frozenProgress`: `final`

Sebelum mengubah counted status, tulis:

```text
CURRENT RULE:
PROPOSED RULE:
BUSINESS EFFECT:
AFFECTED MODULES:
MIGRATION/BACKFILL EFFECT:
TESTS REQUIRED:
```

Jangan mengubah aturan status diam-diam.

## Source-of-truth gate

Cari seluruh duplikasi formula:

- `realizedPct`
- `deviationPct`
- `valueDone`
- `volumeDone * unitPrice`
- `grandTotal`
- `COUNTED_REPORT_STATUSES`
- `plannedPct`
- `bobotSd`
- `prestasiSd`

Setiap perhitungan di luar calculation layer harus dihapus atau diganti call canonical.

Dilarang:
- rumus progress di React component;
- rumus berbeda di PDF/Excel;
- dashboard agregasi sendiri;
- AI menghitung dari raw rows;
- report membuat definisi actual sendiri.

## Fixture emas wajib

Buat fixture permanen dengan input sederhana dan expected manual:

1. RAB Rp100.000.000, plan 20%, actual 0%.
2. Item volume 100 × Rp1.000.000, progress 10 unit.
3. Status draft tidak dihitung.
4. Status dikirim.
5. Status disetujui.
6. Status final.
7. Koreksi report yang sama tidak dobel.
8. Dua tanggal dengan lineage sama.
9. Revisi aktif baru membawa lineage lama.
10. Item hilang dari revisi aktif tidak masuk actual aktif.
11. Backdated report hanya masuk sampai reportDate.
12. Grand total nol.
13. Volume melebihi kontrak ditolak.
14. Multi-lokasi satu paket tidak tercampur.
15. PPN kontrak vs RAB pre-PPN.

Untuk setiap fixture tulis input, hitungan manual, expected, actual, dan selisih.

## Reconciliation gate

Untuk data lokasi dan dataAsOf yang sama, angka berikut wajib identik:

- Ringkasan lokasi;
- halaman Progress;
- dashboard global;
- laporan mingguan;
- laporan bulanan;
- kurva-S;
- PDF;
- Excel;
- WhatsApp;
- AI source payload;
- finance `terpasang` bila definisinya sama.

Buat automated reconciliation test. Perbedaan hanya boleh terjadi bila `dataAsOf` atau level status berbeda dan harus diberi label jelas.

## Date-as-of gate

Setiap calculation/report harus punya:
- `dataAsOf`;
- `periodStart`;
- `periodEnd`;
- timezone `Asia/Jakarta`;
- `reportDate` sebagai tanggal kerja.

Dilarang memakai `new Date()` tersembunyi untuk laporan periode lampau.

Test wajib:
- laporan 12 Juli tidak memasukkan volume 13 Juli;
- minggu ke-n memakai batas tanggal benar;
- timezone tidak menggeser reportDate.

## Revision dan lineage gate

Buktikan:
- basis nilai hanya revisi aktif;
- actual dibawa dengan lineageKey;
- revisi tidak menghitung actual dua kali;
- lineage yang tidak ada pada revisi aktif tidak masuk active progress;
- histori lama tetap dapat ditampilkan dalam konteks revisinya;
- adendum tidak mengubah laporan periode lama tanpa alasan.

## Rounding dan money gate

- uang memakai BigInt rupiah;
- valueDone mengikuti formula canonical;
- persentase dirounding di presentation layer;
- jangan mengubah BigInt uang menjadi Number tanpa alasan;
- RAB pre-PPN dan kontrak incl-PPN dibedakan;
- label membedakan nilai RAB lokasi dan nilai kontrak paket.

## Presentation contract

Setiap angka idealnya membawa metadata:

```ts
{
  value,
  unit,
  label,
  dataAsOf,
  calculationKey,
  sourceEntityIds,
  statusLevel,
  revisionId,
  baselineId
}
```

Label yang diperbolehkan:
- Progress Dilaporkan
- Progress Terverifikasi
- Progress Final
- Rencana s.d. [tanggal]
- Deviasi Terverifikasi

Semua angka harus dapat drill-down ke data pembentuk.

## Test gate

Jalankan:

```bash
pnpm typecheck
pnpm lint
pnpm test --run
pnpm build
pnpm test:e2e
docker build --no-cache -t marlin:test .
```

Wajib ada unit formula, integration PostgreSQL, E2E lifecycle laporan, koreksi tidak dobel, adendum/revisi, reconciliation lintas output, dan fixture snapshot.

## Manual proof wajib dalam jawaban akhir

Berikan tabel:

| Case | Input | Formula manual | Expected | Actual | Status |
|---|---|---|---:|---:|---|

Sertakan juga:
- seluruh file calculation yang berubah;
- seluruh consumer calculation layer;
- hasil pencarian formula duplikat;
- test baru;
- output command;
- known limitations;
- keputusan bisnis yang belum ditetapkan.

Jangan menulis “sudah benar” tanpa proof angka.

## STOP conditions

STOP dan jangan coding bila:
- dokumen dan kode berbeda;
- counted status belum diputuskan;
- report memakai data date berbeda tanpa label;
- formula akan diduplikasi;
- expected fixture belum dapat ditentukan;
- test lama bertentangan dengan rule baru;
- perubahan akan mengubah histori tanpa migration/backfill plan;
- sumber satu angka tidak dapat dijelaskan.

Format konflik:

```text
CONFLICT:
SOURCE A:
SOURCE B:
BUSINESS IMPACT:
SAFE OPTIONS:
RECOMMENDATION:
DECISION REQUIRED:
```

## Definition of done

Pekerjaan progress/laporan selesai hanya bila:
- calculation contract jelas;
- satu canonical calculation layer;
- tidak ada formula duplikat;
- fixture emas hijau;
- reconciliation hijau;
- date-as-of benar;
- revision/lineage benar;
- rounding benar;
- UI label tidak ambigu;
- PDF/Excel/AI identik;
- seluruh test/build hijau;
- manual proof disertakan.


---

## Status penerapan di MARLIN (per 2026-07-27)

Sudah terpasang dan dijaga uji otomatis:

- Calculation layer tunggal: **daftarnya di `PROJECT.md` §3** (lima berkas —
  `progress-calc.ts`, `progress.ts`, `finance/calc.ts`, `plan/rencana-format.ts`,
  `ahsp/rapl-calc.ts`). Jangan menyalin daftar itu ke sini; versi sebelumnya
  hanya menyebut dua berkas dan itu membuat tiga dokumen saling bertentangan
  (audit 2026-08-28, C-1 · DECISIONS 461).
- Reconciliation gate, date-as-of gate, revision/lineage gate, fixture emas —
  `tests/integration/periodic-report.test.ts`.
- Satu revisi RAB & satu baseline aktif per lokasi ditegakkan partial unique
  index di DB, bukan hanya disiplin kode.
- Matriks permission dibangkitkan dari kode + test penjaga.

Terpasang SEBAGIAN sejak DECISIONS 426 (opsi 2 — angka pendamping):

- `getLocationsProgress` menerima `statusLevel: "dilaporkan" | "terverifikasi"`
  (`VERIFIED_REPORT_STATUSES` = disetujui+final di `lifecycle.ts`) — rumus,
  penyebut, dan default TIDAK berubah; dipakai mesin kesiapan termin/PHO dengan
  label "Progress Terverifikasi". Paritasnya diuji
  `tests/integration/progress-terverifikasi.test.ts`.

Belum terpasang, butuh KEPUTUSAN USER (lihat `docs/OPEN_ISSUES.md`):

- Memindahkan BASIS RESMI (dashboard/blanko KKP/keuangan) ke level
  terverifikasi, `frozenProgress`, dan pelarangan label generik "Realisasi".
- Metadata presentasi penuh (`dataAsOf`, `calculationKey`, `statusLevel`,
  `revisionId`, `baselineId`) pada setiap angka.
