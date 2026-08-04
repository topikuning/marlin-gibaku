# Redesign Total UI/UX — Rencana Bertahap

Sumber: **PRD MARLIN** (PDF, lampiran user) + **rancangan Claude Design**
(13 berkas `.dc.html` + `MASTER_PROMPT_TOTAL_UI_UX_REDESIGN_MARLIN.md`).
Keputusan dan konfliknya dicatat di [`DECISIONS.md` 250](../DECISIONS.md).

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
- **Checklist kirim** (§8.7) dengan bahasa sederhana: Belum lengkap / Perlu
  diperiksa / Siap dikirim.
- **State penyimpanan terlihat**: Online / Menyimpan / Tersimpan / Belum
  tersinkron / Gagal / Coba lagi. Antrean sinkron offline BELUM didukung
  backend — tandai sebagai dependency, jangan berpura-pura ada (K3).
- **Koreksi inline**: komentar reviewer muncul dekat field terkait, field
  bermasalah disorot — bukan hanya sebagai banner di atas halaman.

Aturan bisnis TIDAK berubah: satu record unik lokasi+tanggal, siklus koreksi
pada record yang sama, kewajiban "Lengkapi KKP" tetap di Site Manager.

## Fase 3 — Dashboard Eksekutif + Peta operasional

Peta Monitoring **wajib dipertahankan sebagai elemen utama** (Master Prompt §5)
— bukan dekorasi, bukan dipindah ke halaman sulit ditemukan.

- Marker dapat diklik → side panel: lokasi, paket, progress, deviasi, laporan
  terakhir, kendala, readiness.
- Filter marker per status, clustering, fullscreen, toggle Peta/Daftar di
  mobile.
- Satu komponen peta dipakai dashboard dan `/peta` (K6).
- Scope bar (organisasi / paket / provinsi / periode) + "data s.d." eksplisit.

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

## Migrasi URL kanonik (PRD §4.1) — fase tersendiri

Belum dikerjakan. PRD mengusulkan `/proyek/...`, `/pengendalian/...`,
`/dokumen-laporan/...`, `/administrasi/...`; rancangan desain memilih
mempertahankan URL yang ada.

Menyentuh 104 berkas. Dikerjakan **terpisah dari perubahan visual** supaya
kegagalannya bisa ditelusuri, dan hanya bila ada lingkungan dengan basis data
untuk memverifikasinya. Prasyarat: tabel alias → kanonik lengkap, 308 untuk
semua alias, telemetry pemakaian alias (FR-NAV-03), masa kompatibilitas.

---

## Keputusan yang masih menunggu user

| # | Soal | Pilihan teraman yang dipakai sekarang |
|---|---|---|
| K2 | Level progress tunggal (dikirim+disetujui+final digabung) vs istilah Dilaporkan/Terverifikasi/Final | UI menyebut "Progress Dilaporkan" + sumber perhitungannya; slot "Terverifikasi" menunggu calculation layer |
| K3 | Offline queue belum didukung backend | State dirancang penuh di atas draft localStorage; antrean sinkron ditandai dependency |
| K4 | Persona Keuangan & Auditor tanpa role khusus | Keuangan = peran ber-`finance.approve`; Auditor = `exec_viewer` + `audit.view` |
| K8 | Notification center belum ada tabel sendiri | Lonceng memakai antrean `/tindakan`; `Alert` belum dipakai |
| — | Jumlah grup navigasi: PRD enam vs rancangan desain lima | Dipakai enam (PRD) |
| — | Ambang "perlu perhatian" bergeser dari `< 0` ke `< −1` | Sudah diterapkan seragam; lihat DECISIONS 250 |
