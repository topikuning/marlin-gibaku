# Redesign Total UI/UX — Rencana Bertahap

Sumber: **PRD MARLIN** (PDF, lampiran user) + **rancangan Claude Design**
(13 berkas `.dc.html` + `MASTER_PROMPT_TOTAL_UI_UX_REDESIGN_MARLIN.md`).

**Pembagian peran kedua sumber** (ditegaskan user 2026-08-04): rancangan Claude
Design adalah **referensi layout dan style saja**. Arsitektur — route, IA,
lifecycle, permission — mengikuti **PRD**. Kalau keduanya berselisih soal
struktur, PRD yang menang; kalau berselisih soal tampilan, rancangan desain
yang menang. Keputusan dan konfliknya di
[`DECISIONS.md` 250 & 251](../DECISIONS.md).

Urutan fase mengikuti "Urutan implementasi" pada rancangan desain sendiri
(berkas `00 Mulai — Audit & Rencana`), karena fase 1 menyentuh seluruh layar
dan fase 2 adalah yang berdampak terbesar bagi pengguna sesungguhnya.

---

## Aturan yang berlaku di SEMUA fase

1. **Angka tidak pernah dihitung ulang di lapisan tampilan.** Sumbernya tetap
   `progress-calc.ts` / `progress.ts` / `finance/calc.ts` (CLAUDE.md §7).
   Rancangan desain boleh mengubah cara angka DITAMPILKAN, tidak pernah
   nilainya.
2. **Fitur tidak dihapus karena sulit ditempatkan.** Kalau sebuah fungsi
   pindah, alasannya ditulis di tempat ia sekarang tinggal.
3. **Istilah baku sekali pakai satu makna**: Laporan Harian · Kegiatan ·
   Kendala · Recovery · Dilaporkan/Disetujui/Final · Perlu Koreksi · Baseline ·
   Adendum. Progress selalu disebut levelnya ("Progress Dilaporkan") + "data
   s.d.", tidak pernah "Progress" telanjang.
4. **Status tidak pernah disampaikan lewat warna saja** — selalu ada
   label/ikon pendamping.
5. **Mobile bukan desktop yang dikecilkan.** Tabel kritis jadi kartu di
   < 1024px; aksi utama tetap terlihat; target sentuh ≥ 44px.

---

## Fase 1 — Design system & shell ✅ SELESAI

- Navigasi enam grup cara-kerja (PRD §3.3) menggantikan 15 menu datar.
- Sidebar berkelompok; sorotan memakai butir paling spesifik.
- Bottom-nav mobile berbeda per peran (lapangan vs manajemen).
- `/tindakan` — antrean tugas & persetujuan lintas jenis.
- Pencarian global ⌘K di topbar, berjalan di server dan ter-scope.
- Lonceng Perlu Tindakan dengan jumlah sebenarnya.
- Satu ambang deviasi (`lib/deviasi.ts`) menggantikan tiga sumber.
- Kontrak tombol: `primary · secondary · ghost · success · danger ·
  dangerOutline`, ukuran `sm/md/lg`, `disabledReason` wajib untuk tombol mati.
- Token: radius `xl` (kartu 12px), bayangan overlay/popover.
- Alias lama jadi 308 permanen; route duplikat `/aktivitas` dihapus.

---

## Fase 2 — Laporan harian mobile ◐ SEBAGIAN

Pengguna: mandor/pelaksana, sering berumur, satu tangan, di bawah matahari,
jaringan tidak stabil. Ini fokus utama Master Prompt §8.

Sudah ada:

- ✅ **Loop input cepat** (§8.3) — pilih item → fokus otomatis ke volume →
  keypad numerik → simpan → fokus kembali ke pencarian. Sudah ada sejak
  DECISIONS 2026-08-02; sisa volume kontrak juga sudah tampil inline.
- ✅ **Pintasan item** — chip "dilaporkan pada laporan terakhir" + item
  tersering di lokasi itu, diturunkan dari data pemakaian (bukan tabel
  favorit baru).
- ✅ **Hari Ini**: pita 7 hari mendatar (bukan tujuh baris menurun yang
  mendorong tombol lapor ke bawah lipatan) + daftar kendala aktif.

Belum:

- **Wizard longgar 4 langkah** (Pekerjaan & Volume → Kondisi & Sumber Daya →
  Bukti & Kendala → Review & Kirim) — draft aman, bebas mundur. Saat ini
  editornya satu layar.
- ✅ **Checklist kirim** (§8.7) — bahasa sederhana yang menyebut akibat, bukan
  nama field. Tidak menghalangi pengiriman; kelengkapan tetap dijaga server.
- **State penyimpanan terlihat**: Online / Menyimpan / Tersimpan / Belum
  tersinkron / Gagal / Coba lagi. Antrean sinkron offline BELUM didukung
  backend — tandai sebagai dependency, jangan berpura-pura ada (K3).
- **Koreksi inline**: komentar reviewer muncul dekat field terkait, field
  bermasalah disorot — bukan hanya sebagai banner di atas halaman.

Aturan bisnis TIDAK berubah: satu record unik lokasi+tanggal, siklus koreksi
pada record yang sama, kewajiban "Lengkapi KKP" tetap di Site Manager.

## Fase 3 — Dashboard Eksekutif + Peta operasional ◐ SEBAGIAN

- ✅ **Pusat Perhatian Eksekutif** — ubin pengecualian yang bisa diketuk,
  tampil sebelum KPI informatif (FR-HOME-01). Satu sumber dengan lonceng
  topbar dan `/tindakan` lewat `cache()`.
- ✅ **Chip "Data s.d."** terpisah dari "Diperbarui".
- ✅ **Peta operasional**: marker → side panel (lokasi, paket, status lapor,
  deviasi, tautan workspace) alih-alih langsung pindah halaman · filter status
  (sudah ada) · toggle Peta/Daftar di layar sempit · layar penuh + Esc.
- ❌ Belum: **clustering** marker; **scope bar** (organisasi / paket /
  provinsi / periode).
- ⏭️ **K6 dilewati dengan sadar**: `/proyek/peta` SUDAH operasional (dua panel,
  cari, filter provinsi/status, daftar, snapshot lokasi). Yang timpang hanya
  peta dashboard, dan itu sudah diperbaiki. Menggabungkan keduanya sekarang
  berisiko meregresi halaman yang sudah bekerja demi keseragaman kode saja.

## Fase 4 — Workspace lokasi enam tab ◐ SEBAGIAN

- ✅ Tab dikurangi dari delapan jadi enam: Ringkasan · Rencana & RAB ·
  Pelaksanaan · Progress · Keuangan · Administrasi. Route tidak dipindah;
  halaman yang bernaung di bawah satu tab mendapat sub-tab.
- ❌ Belum: RAB + revisi + **baseline + jadwal** + rencana mingguan digabung
  ke tab Rencana. Baseline/editor jadwal masih di Progress, dan memisahnya
  memutus rantai mental biaya → volume → waktu → target mingguan (PRD §5.4).
- ❌ Belum: Progress dipisah jadi mode kerja (Monitor · Item tertinggal ·
  Riwayat) — sekarang masih satu layar campur.

## Fase 5 — Paket, Progress portfolio, Keuangan portfolio, Dokumen

- Keuangan **approval-first**: antrean keputusan dulu, input lewat drawer —
  bukan form permanen menumpuk di layar monitoring.
- Dokumen **list-first**: milestone/kepatuhan → dokumen → status → expiry →
  requirement yang kurang; unggah lewat drawer, versi lama tidak ditimpa.
- Tab **Keuangan Paket** (gap P0 PRD): kontrak → alokasi lokasi → komitmen →
  realisasi → billing.

## Fase 6 — Laporan & Distribusi + AI Intelligence

Satu pusat produksi artefak (Report Studio), bukan dua pembuat laporan (K7).
Lifecycle: Draft → In Review → Approved → Frozen → Distributed. Satu structured
report jadi sumber untuk layar, PDF, Excel, dan WhatsApp — **tidak pernah empat
sumber angka berbeda**.

## Fase 7 — Administrasi, sistem, audit, pola state menyeluruh

Termasuk QA aksesibilitas dan kelengkapan state (loading/empty/error/denied/
offline/partial) di seluruh halaman.

---

## Migrasi URL kanonik (PRD §4.1) ◐ SEBAGIAN

- ✅ **Keluarga route** dipindah: `/proyek/…`, `/pelaksanaan/…`,
  `/pengendalian/…`, `/dokumen-laporan/…`, `/administrasi/…`. Seluruh URL lama
  308 permanen ke tujuan kanoniknya, diuji E2E (20 alias). Lihat DECISIONS 251.
- ❌ **Konsolidasi `?tab=` / `?view=`** belum: `/proyek?view=paket|lokasi|peta`
  dan `/proyek/lokasi/[slug]?tab=…`. Sub-halaman masih berupa segmen path.
  Ini penulisan ulang komposisi halaman, bukan pemindahan berkas.
- ❌ **Telemetry pemakaian alias** (FR-NAV-03) belum ada.

## Status gap PRD

### P0 — SELESAI seluruhnya

| Gap | Status |
|---|---|
| Unified Task & Approval Inbox | ✅ `/tindakan` |
| Global Search & Context Switcher | ✅ ⌘K server-side + LocationSwitcher |
| Guided Package Readiness | ✅ `/proyek/paket/[id]/setup` |
| Package-level Finance | ✅ `/proyek/paket/[id]/keuangan` |
| Unified Report Lifecycle | ✅ sudah ada sebelumnya — `AiArtifactStatus` draft→direview→disetujui→beku→terkirim (DECISIONS 193/194) |
| Canonical Route Migration | ✅ keluarga route + 308 (DECISIONS 251) |

### TERHALANG SCHEMA — tidak dikerjakan, dan tidak boleh dipaksakan

User menetapkan **nol perubahan database**. Gap berikut mustahil tanpa tabel
atau kolom baru; mengerjakannya setengah jalan (mis. menyimpan di JSON blob
atau menumpang tabel lain) justru menciptakan utang yang lebih mahal daripada
migrasi yang jujur.

| Gap | Butuh |
|---|---|
| Tender Evaluation & bid comparison (P1) | tabel Bidder + Evaluasi |
| Vendor Performance scorecard (P1) | tabel penilaian lintas paket |
| Import/Data Quality Centre (P1) | tabel ImportJob + error row |
| Scheduled Distribution (P1) | tabel jadwal + delivery status |
| Closure Workspace / Partial PHO (P1/P2) | model serah terima parsial |
| Auto Termin Readiness (P1) | penyimpanan rule configurable |
| Cash Forecast UI (P2) | penyimpanan input forecast |
| Reference Geography BPS (P2) | tabel master wilayah |
| Progress level "Terverifikasi" (K2) | perubahan calculation layer + kolom |

### BISA tanpa schema, belum dikerjakan

- ✅ **Header keamanan** (P2): CSP **report-only** (menegakkan langsung
  berisiko mematikan halaman — Leaflet/AG Grid/Next menyuntik inline),
  X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
  ❌ Rate limit non-login butuh penyimpanan tahan-restart → terhalang schema.
  ❌ RLS terhalang schema.
- Peta operasional (side panel marker, filter status, fullscreen, Peta/Daftar).
- Wizard laporan harian 4 langkah + checklist kirim + state penyimpanan.
- Koreksi inline (komentar reviewer dekat field).
- Baseline & jadwal pindah ke tab Rencana; Progress jadi mode kerja.
- Keuangan approval-first; dokumen list-first.

### Keputusan teknis: `?tab=` TIDAK dipakai

PRD §4.1 mengusulkan state tampilan lewat query param
(`/proyek/lokasi/[slug]?tab=…`). **Tidak dikerjakan, dengan alasan.**

Tujuan PRD — mengurangi jumlah KELUARGA route — sudah tercapai lewat migrasi
keluarga. Mengubah sub-halaman jadi satu halaman ber-`?tab=` justru melawan
FR-PERF-01 PRD sendiri ("perpindahan tab tidak memuat data yang tidak
diperlukan"): segmen path memberi code-splitting, streaming, dan `loading`
per-tab secara otomatis, sedangkan satu halaman ber-query-param memuat
semuanya dalam satu berkas. Segmen path juga membuat setiap tab punya URL yang
bisa di-bookmark tanpa bergantung pada parsing query.

## Keputusan yang masih menunggu user

| # | Soal | Pilihan teraman yang dipakai sekarang |
|---|---|---|
| K2 | Level progress tunggal (dikirim+disetujui+final digabung) vs istilah Dilaporkan/Terverifikasi/Final | UI menyebut "Progress Dilaporkan" + sumber perhitungannya; slot "Terverifikasi" menunggu calculation layer |
| K3 | Offline queue belum didukung backend | State dirancang penuh di atas draft localStorage; antrean sinkron ditandai dependency |
| K4 | Persona Keuangan & Auditor tanpa role khusus | Keuangan = peran ber-`finance.approve`; Auditor = `exec_viewer` + `audit.view` |
| K8 | Notification center belum ada tabel sendiri | Lonceng memakai antrean `/tindakan`; `Alert` belum dipakai |
| — | Jumlah grup navigasi: PRD enam vs rancangan desain lima | Dipakai enam (PRD) — desain hanya mengatur tampilan |
| — | Ambang "perlu perhatian" bergeser dari `< 0` ke `< −1` | Sudah diterapkan seragam; lihat DECISIONS 250 |
