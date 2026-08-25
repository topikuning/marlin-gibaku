# ARCHITECTURE — Integrated Project Control & Assurance

> Phase 1. Baca `CURRENT_STATE_AUDIT.md` dulu. Prinsip: satu MARLIN, satu DB,
> satu auth, satu calculation layer, satu audit trail.

## 1. Capability map

```
MARLIN
├── Contractor Workspace        (existing: Hari Ini, harian, kendala, foto, dokumen)
│   └── + tindak lanjut temuan (finding.respond)
├── Wakil PPK Workspace         (BARU: /verifikasi)
│   ├── verifikasi laporan harian eksternal (report.verify_external)
│   ├── inspeksi lapangan (inspection.manage)
│   ├── temuan: buat / klarifikasi / verifikasi / tutup / buka kembali
│   └── verifikasi bukti (EvidenceLink.verifStatus)
├── Findings & Follow-up        (BARU: /temuan — lintas peran)
├── Early Warning System        (BARU: /perlu-tindakan — rule-based)
├── Readiness (termin/PHO/FHO)  (BARU: /kesiapan — rule-based)
├── Document Control            (existing: /dokumen + AdminMilestone board)
├── AI Intelligence             (existing /ai + adapter temuan)
└── Reporting                   (existing + register temuan xlsx)
```

## 2. Data model

### Finding (temuan)

```
Finding
├─ locationId (wajib; paket diturunkan lewat relasi — tidak ada kolom ganda)
├─ source: inspeksi | laporan_harian | dokumen | manual
├─ inspectionId? · reportId?           ← jejak asal
├─ lineageKey? + workItemName?         ← item RAB terkait (path stabil, bukan FK node)
├─ category: mutu | volume | k3 | administrasi | jadwal | lingkungan | lainnya
├─ severity: IssueSeverity (reuse: rendah|sedang|tinggi|kritis)
├─ title, description, findingDate, dueDate?
├─ status: baru → menunggu_klarifikasi → ditindaklanjuti →
│          menunggu_verifikasi → selesai → dibuka_kembali (lihat §4)
├─ raisedById · assignedToId?/assignedName? · closedById?/closedAt? · reopenCount
├─ FindingStatusHistory (append-only, trigger DB — pola DailyReportStatusHistory)
├─ FindingClarification (question/askedBy → response/respondedBy)
├─ FindingNote (tindak lanjut pelaksana, append)
└─ EvidenceLink[] (bukti)
```

Kenapa `lineageKey` bukan FK `rabNodeId`: node mati saat revisi RAB diganti;
lineage adalah identitas stabil lintas revisi (pola yang sama dengan
`DailyReportItem`).

### EvidenceLink (abstraksi bukti — TANPA duplikasi berkas)

```
EvidenceLink
├─ sumber: TEPAT SATU dari { photoId, documentId }        (CHECK constraint)
├─ induk : MINIMAL SATU dari { findingId, inspectionId, clarificationId } (CHECK)
├─ caption?, addedById
└─ verifikasi: verifStatus (belum|diterima|ditolak) + verifiedById/At + verifNote
```

Foto & dokumen tetap tinggal di tabel aslinya; satu foto bisa ditautkan dari
beberapa objek tanpa disalin.

### Inspection (inspeksi lapangan pemeriksa)

```
Inspection: locationId · inspectorId · inspectionDate · title · notes ·
recommendation? · gps? · status draft→final · finalizedAt? · findings[] · evidence[]
```

Berbeda dari `FieldActivity` (dokumentasi PELAKSANA): inspeksi milik pemeriksa,
bisa melahirkan `Finding`, dan difinalkan pemeriksa sendiri.

### ReportVerification (verifikasi eksternal laporan harian)

Append-only; TIDAK mengubah `DailyReport.status` dan TIDAK menyentuh
`COUNTED_REPORT_STATUSES` — angka resmi tidak berubah karena wakil menekan
tombol. Baris terakhir per laporan = keadaan terkini.

```
ReportVerification: reportId · status (diverifikasi|perlu_klarifikasi|ditolak)
· note? · verifiedById · createdAt
```

"Belum diperiksa" = tidak ada baris (bukan status tersimpan).

## 3. Role matrix (delta — selengkapnya digenerate `pnpm docs:permission`)

| Capability | SA | PD | AM | PM | SM | Pelaksana | Exec | Wakil PPK |
|---|---|---|---|---|---|---|---|---|
| finding.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| finding.create | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| finding.respond | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| finding.verify | ✓ | ✓ | – | – | – | – | – | ✓ |
| inspection.manage | ✓ | ✓ | – | – | – | – | – | ✓ |
| report.verify_external | ✓ | ✓ | – | – | – | – | – | ✓ |

Pemisahan tugas tambahan BERBASIS ORANG (pola DECISIONS 218): penutup temuan
tidak boleh orang yang sama dengan penindak terakhir? — TIDAK diberlakukan;
yang diberlakukan: **pembuat tindak lanjut tidak bisa memverifikasi** karena
`finding.respond` dan `finding.verify` tidak pernah dimiliki peran yang sama
(kecuali SA/PD; SA/PD adalah break-glass yang selalu ter-audit).

## 4. State machines (semua di `src/lib/lifecycle.ts`)

```
FINDING_TRANSITIONS
  baru                → menunggu_klarifikasi | ditindaklanjuti | menunggu_verifikasi | selesai
  menunggu_klarifikasi→ ditindaklanjuti | menunggu_verifikasi | selesai
  ditindaklanjuti     → menunggu_klarifikasi | menunggu_verifikasi | selesai
  menunggu_verifikasi → selesai | ditindaklanjuti          (verifikator menolak → kembali)
  selesai             → dibuka_kembali                      (verifikator saja)
  dibuka_kembali      → menunggu_klarifikasi | ditindaklanjuti | menunggu_verifikasi | selesai

INSPECTION: draft → final (final immutable kecuali super_admin — tidak ada unfinal v1)
REPORT_VERIFICATION: bukan state machine tersimpan; tiap aksi = baris baru
```

Siapa boleh transisi apa (ditegakkan di actions, bukan di lifecycle):

- `menunggu_klarifikasi` ← hanya `finding.verify` (dengan pertanyaan).
- `ditindaklanjuti` ← `finding.respond` (catat tindak lanjut / jawab klarifikasi).
- `menunggu_verifikasi` ← `finding.respond` (pelaksana menyatakan selesai).
- `selesai` / `dibuka_kembali` ← hanya `finding.verify`. Menutup temuan
  `menunggu_verifikasi` menuntut catatan; membuka kembali menuntut alasan.

## 5. Workflow inti

```
Wakil PPK inspeksi lokasi → catat Inspection (+bukti foto/dokumen)
  → angkat Finding (severity, due date, assigned ke SM)
Kontraktor (SM) → FindingNote tindak lanjut (+bukti) → ajukan menunggu_verifikasi
Wakil PPK → verifikasi bukti (EvidenceLink) → tutup (selesai) ATAU tolak (kembali
  ditindaklanjuti) ATAU buka kembali setelah selesai
Laporan harian dikirim/disetujui → Wakil PPK memeriksa → ReportVerification
  (diverifikasi / perlu_klarifikasi / ditolak) — jejak untuk PPK, angka resmi tetap
EWS membaca semuanya → Perlu Tindakan (Kritis/Tinggi/Sedang) → deep-link
Kesiapan membaca progress terverifikasi + milestone + temuan → Siap/Belum + alasan
```

## 6. Calculation integrity

- `verifiedProgress` = fungsi `getLocationsProgress` YANG SAMA dengan parameter
  `statusLevel: "terverifikasi"` → daftar status `["disetujui","final"]`
  menggantikan `COUNTED_REPORT_STATUSES` di WHERE — formula tidak berubah,
  penyebut tidak berubah, hanya saringan status. Default tetap `"dilaporkan"`
  (angka resmi TIDAK berubah — CIP opsi 2, diputuskan prompt user §18).
- Label wajib: "Progress Dilaporkan" (angka resmi existing) vs
  "Progress Terverifikasi (internal)". Catatan: "terverifikasi" di sini =
  disetujui+final INTERNAL (SM); verifikasi Wakil PPK adalah jejak terpisah dan
  TIDAK mengubah angka — menjadikannya basis angka = keputusan user terpisah.
- EWS & kesiapan mengonsumsi `LocationProgress` / milestoneBoard / query temuan —
  tidak menghitung ulang formula apa pun.

## 7. Integration map

- **WA**: tidak ada kiriman WA baru di v1 (tidak ada tombol palsu). Kandidat
  lanjutan: pengingat temuan lewat tenggat menumpang `penjadwal-tenggat` pattern.
- **Drive**: tidak ada unggahan baru di v1.
- **AI**: adapter `temuan` di `ai-hub/adapters.ts` (metrics: `temuan_terbuka`,
  `temuan_kritis`, `temuan_lewat_tenggat`, `temuan_dibuka_kembali`), dipagari
  `finding.view` di `adapters-pagar.ts`. Ask MARLIN otomatis bisa menjawab
  pertanyaan temuan dengan sitasi; AI tetap tidak menulis temuan.
- **Audit**: aksi baru memakai `auditIn` untuk transisi status (pola AUDIT-01),
  `audit` untuk mutasi non-status. Aksi: `finding.create`, `finding.clarify`,
  `finding.respond`, `finding.submit_verify`, `finding.verify_close`,
  `finding.reject`, `finding.reopen`, `inspection.create`, `inspection.finalize`,
  `report.verify_external`, `evidence.link`, `evidence.verify`.
