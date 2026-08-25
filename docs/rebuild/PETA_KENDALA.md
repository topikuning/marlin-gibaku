# Peta pencatatan kendala — keadaan sekarang & usulan satu pusat

Dibuat 2026-08-20 atas keberatan user:

> *"pencatatan kendala, saat ini menurutku tidak efektif, setelah dicatat tidak
> ada tindak lanjut, lalu akan rancu dengan kendala di laporan harian atau
> kegiatan lapangan. kamu perlu memetakan lagi soal pencatatan kendala ini."*

Keberatan itu benar seluruhnya, dan hasil penelusuran di bawah lebih buruk
daripada yang tersirat di kalimat itu.

> **Keadaan berkas ini:** bagian 1–4 memotret keadaan SEBELUM perbaikan dan
> sengaja dibiarkan apa adanya sebagai catatan sebabnya. Apa yang sudah
> dibangun ada di bagian 5.

---

## 1. Keadaan sekarang — TIGA pintu masuk, satu yang bisa ditindaklanjuti

| Tempat mencatat | Disimpan sebagai | Punya status? | Punya PIC & tenggat? | Bisa ditindaklanjuti? |
|---|---|---|---|---|
| Progress → "Catat kendala" | `Issue` | ✅ terbuka/ditangani/selesai | ❌ hanya lewat aksi pemulihan | ✅ |
| Laporan harian → kendala | `Issue` (ber-`reportId`) | ✅ | ❌ sama | ✅ |
| Kegiatan lapangan → "Kendala" | **`FieldActivity.kendala`** (teks bebas) | ❌ | ❌ | ❌ **tidak pernah** |
| Catatan laporan harian | `DailyReport.notes` (teks bebas) | ❌ | ❌ | ❌ |
| Catatan item laporan | `DailyReportItem.notes` (teks bebas) | ❌ | ❌ | ❌ |
| Ask MARLIN (AI) | `Issue` + `RecoveryAction` | ✅ | ✅ | ✅ |

Jadi kata "kendala" di MARLIN menunjuk **dua benda yang berbeda**: satu entitas
yang punya siklus hidup, dan beberapa kolom teks yang tidak punya apa-apa.
Orang lapangan tidak bisa membedakan keduanya dari layar — dua-duanya berlabel
"Kendala", dan keduanya terasa seperti "sudah dilaporkan".

**Akibat paling nyata:** kendala yang ditulis di Kegiatan Lapangan tidak pernah
muncul di daftar kendala mana pun, tidak pernah dihitung, tidak pernah dikejar.
Ia hanya terbaca lagi kalau ada orang membuka kegiatan itu satu per satu.

---

## 2. Yang hilang, diurutkan dari yang paling merusak

### 2.1 Tidak ada halaman kendala terpusat — sama sekali

`find src/app -type d | grep -i "kendala\|issue"` → **kosong**. Kendala hanya
bisa dilihat:

- di dalam tab Progress **satu lokasi**, di bawah tabel item tertinggal;
- sebagai ringkasan di dashboard eksekutif `/aktivitas`;
- lewat pertanyaan WhatsApp.

Tidak ada satu tempat pun untuk menjawab *"kendala apa saja yang terbuka di 83
lokasi, siapa pemiliknya, mana yang lewat tenggat"*. Padahal itu pertanyaan
yang membuat pencatatan kendala ada gunanya.

### 2.2 Kendala tidak punya pemilik maupun tenggat

`Issue` hanya punya `raisedById` — siapa yang MELAPOR. Tidak ada `picUserId`,
tidak ada `dueDate`. PIC dan tenggat baru lahir kalau seseorang menambah
**aksi pemulihan**.

Artinya kendala yang dicatat lalu dibiarkan adalah kendala **tanpa pemilik**,
dan sistem tidak punya cara mengetahui siapa yang harus ditagih. Tangkapan
layar user memperlihatkan tepat itu: empat kendala, keempatnya *"Belum ada aksi
pemulihan."*

### 2.3 Tidak ada yang mengejar

`dashboard.ts` sudah menghitung `late` (aksi pemulihan lewat tenggat dan belum
selesai) dan mengurutkan kendala: terlambat → tingkat → tenggat. Perhitungannya
benar dan sudah ada. Yang tidak ada: **tidak seorang pun diberi tahu.** Tidak
ada pengingat WhatsApp, tidak ada eskalasi, tidak ada angka "kendala terbuka"
di layar yang dibuka tiap hari.

Kendala yang tidak pernah menagih siapa pun akan berhenti dicatat — dan itulah
yang sedang terjadi.

### 2.4 Tidak ada penjaga duplikat

Tangkapan layar user memuat **"Lahan belum bisa clear" tiga kali**, tanggal
sama, tingkat sama, semuanya terbuka. Tidak ada pemeriksaan judul serupa saat
mencatat, dan tidak ada cara menggabungkan.

Tiga baris untuk satu masalah membuat hitungan "berapa kendala terbuka"
kehilangan arti, dan mendorong kendala lain turun dari layar.

### 2.5 Status `selesai` tidak menuntut apa pun

Menutup kendala tidak meminta catatan penutup maupun bukti. Kendala bisa
"selesai" tanpa satu kalimat pun tentang bagaimana ia selesai — sehingga
riwayatnya tidak bisa dipakai belajar, dan tidak bisa dipertanggungjawabkan ke
PPK.

---

## 3. Yang SUDAH ada dan tidak perlu dibangun ulang

Penting supaya usulan di bawah tidak terbaca lebih besar daripada yang perlu:

- **Model & aksinya lengkap**: `Issue` → `RecoveryAction` → `RecoveryUpdate`,
  dengan `src/lib/issues.ts` yang sudah ber-`requireCapability("issue.manage")`
  + `requireLocationAccess` + zod + `audit()`.
- **Perhitungan terlambat + pengurutan prioritas** sudah ada di
  `dashboard.ts` (`kendalaAll`).
- **Kendala sudah bisa ditanya lewat WhatsApp**, termasuk per periode
  (DECISIONS 381) dan lewat pencarian catatan (DECISIONS 382/383).
- **Kendala sudah masuk laporan periodik KKP** (`periodic-report.ts`).

Yang kurang bukan mesinnya. Yang kurang **satu tempat untuk melihatnya, dan
seseorang yang ditagih.**

---

## 4. Usulan: satu pusat kendala

### 4.1 Rute baru `/kendala`

Satu halaman lintas lokasi, dipotong hak akses seperti halaman lain:

- **Papan**: Terbuka · Ditangani · Lewat tenggat · Selesai (30 hari terakhir)
- **Saringan**: lokasi, paket, tingkat, PIC, sumber (progress / laporan harian /
  kegiatan lapangan)
- **Urutan bawaan**: lewat tenggat → tingkat → tenggat terdekat (rumus yang
  SUDAH ada di `dashboard.ts`, dipindah ke calculation layer, bukan ditulis
  ulang)
- **Aksi massal**: tetapkan PIC, tetapkan tenggat, gabungkan duplikat

### 4.2 `Issue` diberi pemilik & tenggat

Tambahan kolom: `picUserId`, `dueDate`, `closedAt`, `closingNote`.

Alasannya bukan kelengkapan: **kendala tanpa pemilik tidak bisa ditagih**, dan
menaruh PIC hanya di aksi pemulihan berarti kendala baru punya pemilik setelah
seseorang sempat merencanakan pemulihan — padahal justru kendala yang belum
disentuh yang paling perlu ditagih.

### 4.3 Kendala kegiatan lapangan DINAIKKAN jadi `Issue`

`FieldActivity.kendala` berhenti menjadi teks bebas yang mati. Dua pilihan yang
perlu diputuskan user (bagian 5).

### 4.4 Penjaga duplikat saat mencatat

Sebelum menyimpan, cari kendala TERBUKA di lokasi sama dengan judul yang mirip
(normalisasi + kemiripan). Kalau ada, tawarkan: *"Sudah ada kendala serupa
dibuka 18 Agt — tambahkan sebagai perkembangan, atau tetap buat baru?"*

Bukan menolak. Menolak akan membuat orang menulis judul yang sedikit berbeda
supaya lolos, dan duplikatnya jadi lebih sulit dikenali.

### 4.5 Kendala menagih lewat kanal yang sudah dipakai

Pengingat harian WhatsApp sudah ada. Kendala lewat tenggat ikut menumpang di
sana, ke grup paketnya:

> ⚠️ 3 kendala lewat tenggat di KNMP Banyuwangi
> • Lahan belum bisa clear – Kedungrejo – PIC Budi – lewat 4 hari

Tanpa ini, poin 2.3 tidak terselesaikan oleh halaman mana pun.

---

## 5. Yang diputuskan user, dan apa yang sudah dibangun

Keputusan diambil 2026-08-20; rinciannya di DECISIONS 392.

| Pertanyaan | Jawaban user | Keadaan |
|---|---|---|
| A. Kendala di Kegiatan Lapangan | **Otomatis jadi Issue saat difinalkan** | ✅ `src/lib/kendala/naikkan.ts` |
| B. Siapa boleh jadi PIC | **Pengguna MARLIN + nama bebas** | ✅ `Issue.picUserId` + `Issue.picName` |
| C. Catatan penutup wajib? | Opsional, tapi diminta saat menutup | ✅ `Issue.closingNote` |
| D. Pengingat lewat tenggat | **Grup paket, ringkas** | ✅ `src/lib/kendala/penjadwal-tenggat.ts` |

Risiko pilihan A ("bisa melahirkan banyak Issue dari catatan yang sebenarnya
sekadar keterangan") ditahan di `src/lib/kendala/dari-kegiatan.ts`: isian yang
berarti "tidak ada kendala" tidak melahirkan apa pun, dan penjaga duplikat
menahan baris kedua untuk masalah yang sama.

Risiko pilihan D (pengingat harian yang berhenti dibaca) ditahan peredam
pengulangan: satu grup dikirimi lagi hanya kalau daftarnya berubah, atau sudah
lewat tiga hari.

### Yang masih terbuka

- **Aksi massal** di papan (tetapkan PIC/tenggat sekaligus, gabungkan duplikat)
  belum ada — sekarang satu per satu lewat formulir baris.
- ~~**Menggabungkan** dua kendala yang terlanjur kembar~~ → selesai, DECISIONS
  393. Tersedia di tab Progress dan di papan `/kendala`; kembarnya ditutup dan
  ditandai, tidak dihapus, dan aksi pemulihannya ikut pindah.
- **Eskalasi** bertingkat (mis. lewat 14 hari → naik ke manajemen) belum ada.

---

## 6. Yang TIDAK diusulkan

- **Bukan** membuat model baru. `Issue` sudah benar bentuknya; yang kurang
  kolom pemilik/tenggat dan satu halaman.
- **Bukan** memindahkan kendala keluar dari tab Progress. Di situ ia berguna —
  kendala lokasi itu, di samping angka lokasi itu. Yang ditambahkan pusatnya,
  bukan penggantinya.
- **Bukan** menyentuh `DailyReport.notes` / `DailyReportItem.notes`. Itu memang
  catatan bebas, bukan kendala, dan sudah bisa dicari lewat pencarian narasi
  (DECISIONS 382).
