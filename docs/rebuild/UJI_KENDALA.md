# Cara menguji pusat kendala

Untuk diuji langsung di layar, tanpa menjalankan perintah apa pun.
Semua kata bertanda `→` adalah yang harus Anda LIHAT; kalau yang muncul lain,
itu temuan.

Menyangkut DECISIONS 392 (satu pusat) + 393 (gabung kembar).

---

## 0. Peta singkat: sekarang kendala masuk dari EMPAT pintu

| Pintu | Di mana | Label sumber di papan |
|---|---|---|
| Progress → "Catat kendala" | `/lokasi/<lokasi>/progress`, bagian Kendala & pemulihan | Dicatat langsung |
| Laporan harian → "Ada kendala" | Hari Ini, saat mengirim laporan | Laporan harian |
| Kegiatan lapangan → kolom "Kendala" | `/lokasi/<lokasi>/kegiatan`, saat **difinalkan** | Kegiatan lapangan |
| Ask MARLIN → usulan disetujui | `/ai` | Ask MARLIN |

Keempatnya bermuara ke SATU tempat: **menu Kendala** (`/kendala`).
Tidak ada lagi kendala yang hanya jadi teks.

---

## A. Papan terpusat berfungsi

**A-1.** Buka menu **Kendala** di sidebar.

→ Lima angka di atas: Terbuka · Ditangani · Lewat tenggat · Belum ada pemilik ·
Selesai 30 hari.
→ Daftar kendala dari **semua lokasi yang boleh Anda lihat**, bukan satu lokasi.

**A-2.** Masuk sebagai Site Manager yang hanya ditugaskan di 1 lokasi.

→ Papan hanya memuat kendala lokasi itu. Angka ringkasannya juga hanya menghitung
lokasi itu — bukan angka nasional yang dipotong tampilannya.

**A-3.** Klik saringan **Lewat tenggat**.

→ Hanya kendala yang tenggatnya sudah lewat DAN belum selesai.
→ Kendala "selesai" yang tenggatnya lewat TIDAK ikut. (Kendala selesai tidak
pernah terlambat.)

**A-4.** Perhatikan urutan bawaannya.

→ Lewat tenggat di atas, lalu "Belum ada pemilik", lalu tingkat, lalu tenggat
terdekat.
→ Kendala **rendah yang lewat tenggat** harus di ATAS kendala **kritis yang
tenggatnya masih besok**. Ini disengaja: yang janjinya sudah lewat terbukti
tidak tertangani.

---

## B. Kendala punya pemilik dan tenggat

**B-1.** Di papan, pada satu kendala, isi PIC = pengguna MARLIN + tenggat besok.
Simpan.

→ Lencana "Belum ada pemilik" hilang.
→ Angka "Belum ada pemilik" di atas berkurang satu.

**B-2.** Pada kendala lain, isi PIC dengan **nama bebas** (mis. "PLN Rayon
Muncar").

→ Di bawah namanya muncul keterangan **"di luar MARLIN – tanpa pengingat"**.
Itu disengaja: nama bebas tidak bisa dikirimi pengingat, dan layar mengatakan
itu daripada membuatnya terlihat sama dengan PIC yang bisa ditagih.

**B-3.** Coba isi PIC pengguna MARLIN **dan** nama bebas sekaligus.

→ Ditolak: *"Pilih SATU: pengguna MARLIN atau nama PIC luar – bukan keduanya."*
Kalau boleh dua-duanya, "siapa yang ditagih" punya dua jawaban dan pengingat
harus menebak.

---

## C. Kendala kegiatan lapangan tidak lagi hilang

**C-1.** Buat kegiatan lapangan baru. Buka "Kendala & tindak lanjut", isi kolom
**Kendala** dengan kalimat sungguhan, mis. *"Akses jalan longsor, alat berat
tertahan di desa"*. Isi juga Solusi. **Finalkan.**

→ Pesan sukses: *"Kegiatan difinalkan. Kendalanya dicatat di papan kendala."*
→ Buka menu Kendala → kendala itu ADA, berlabel sumber **Kegiatan lapangan**.
→ Buka kendalanya → uraiannya memuat teks utuh + baris *"Rencana penanganan
(dari kegiatan): …"*.

**C-2.** Buat kegiatan lain, isi kolom Kendala dengan **`-`** (atau *"nihil"*,
*"tidak ada kendala yang berarti"*, *"aman"*). Finalkan.

→ Pesan sukses BIASA, tanpa kalimat tambahan.
→ Papan kendala TIDAK bertambah. Ini yang menahan papan dari banjir baris "-".

**C-3.** Isi kolom Kendala dengan *"Tidak ada material besi di lokasi"*.
Finalkan.

→ Kendala ini **HARUS masuk**. Kalimatnya memuat "tidak ada" tapi ia kendala
sungguhan. Kalau ini tidak masuk, penyaringnya terlalu rakus — laporkan.

**C-4.** Buka kembali kegiatan dari C-1, ubah teks kendalanya, finalkan lagi.

→ Kendala di papan **tidak berlipat**, dan PIC/tenggat yang sudah Anda isi
**tidak hilang**. Satu kegiatan = paling banyak satu kendala.

---

## D. Duplikat ditahan di pintu masuk

**D-1.** Di `/lokasi/<lokasi>/progress`, catat kendala berjudul
*"Lahan belum bisa clear"*.

**D-2.** Catat lagi di lokasi yang sama, judulnya *"Lahan belum clear"*.

→ Bukan tersimpan, bukan ditolak — muncul **tawaran**: *"Sudah ada kendala
serupa yang masih terbuka di lokasi ini"* berikut daftarnya dan tanggalnya.
→ Ada tombol **"Tetap buat kendala baru"**. Kalau Anda tekan, ia tersimpan.
Ini disengaja: menolak hanya melatih orang mengubah judul sedikit supaya lolos.

**D-3.** Catat kendala berjudul *"Akses jalan rusak"*, lalu *"Akses jalan
longsor"*.

→ TIDAK ada tawaran duplikat. Dua kerusakan berbeda pada jalan yang sama adalah
dua masalah. Kalau muncul tawaran di sini, ambangnya terlalu longgar —
laporkan.

**D-4.** Catat *"Lahan belum bisa clear"* di **lokasi lain**.

→ TIDAK ada tawaran. Lokasi berbeda = masalah berbeda.

---

## E. Kembar yang terlanjur ada bisa dirapikan

Ini yang menjawab tiga baris "Lahan belum bisa clear" di layar Anda.

**E-1.** Di papan Kendala (atau di tab Progress), pada salah satu kembarnya
tekan **"Gabungkan sebagai kembar"**.

→ Daftar pilihannya memuat kendala lain di lokasi yang sama, **kembarannya
paling atas** (diurutkan berdasar kemiripan judul, bukan tanggal).
→ Ada keterangan: *"Kendala ini ditutup dan ditandai kembar – tidak dihapus."*

**E-2.** Pilih induknya, tekan Gabungkan.

→ Barisnya **hilang** dari papan dan dari tab Progress.
→ Angka "Terbuka" berkurang satu.
→ Angka **"Selesai 30 hari" TIDAK bertambah**. Ini penting: kembar bukan
pekerjaan yang selesai, dan menghitungnya sebagai selesai akan membuat angka
kinerja berbohong.

**E-3.** Sebelum menggabungkan, tambahkan aksi pemulihan pada kembarnya. Lalu
gabungkan.

→ Pesan sukses menyebut *"— N aksi pemulihan ikut dipindahkan"*.
→ Aksi itu sekarang ada di kendala INDUK. Rencana orang tidak boleh ikut
terkubur.

**E-4.** Coba gabungkan kendala ke kendala di **lokasi lain**.

→ Pilihan lokasi lain tidak pernah ditawarkan. (Kalau lolos lewat cara lain,
aksinya menolak: *"Hanya kendala di lokasi yang sama yang bisa digabungkan."*)

**E-5.** Gabungkan A ke B. Lalu coba gabungkan C ke A.

→ Ditolak: *"Kendala tujuan sendiri sudah digabungkan ke kendala lain – pilih
kendala induknya."* Rantai tidak diizinkan.

**E-6.** Pada kendala yang sudah digabungkan, coba ubah statusnya kembali ke
"Terbuka".

→ Ditolak: *"Kendala ini sudah digabungkan – ubah statusnya di kendala
induknya."*

**E-7.** Buka laporan periodik KKP untuk periode yang memuat kembar itu.

→ Kembarnya **tidak tercetak**. Satu masalah yang tercetak tiga kali membuat
seluruh laporan kehilangan kredibilitas di depan PPK.

---

## F. Ada yang menagih

**F-1.** Beri satu kendala tenggat **kemarin**, PIC terisi. Tunggu putaran cron
harian (atau minta operator memicunya).

→ Grup WA paket menerima:

```
⚠️ *MARLIN – Kendala lewat tenggat*
KNMP Banyuwangi

1 kendala sudah lewat tenggat:
• Lahan belum bisa clear – Kedungrejo – PIC Budi – lewat 1 hari

Perbarui tenggat atau tutup kendalanya lewat menu *Kendala* di MARLIN.
```

**F-2.** Biarkan sehari, jangan ubah apa pun. Tunggu putaran berikutnya.

→ Grup **TIDAK** dikirimi lagi. Daftar yang sama tidak diulang sebelum 3 hari.
Mengirim daftar sama tiap 24 jam adalah cara tercepat membuat grup berhenti
membaca peringatan MARLIN.

**F-3.** Tambah satu kendala lewat tenggat lagi. Tunggu putaran berikutnya.

→ Grup dikirimi lagi, sekarang menyebut 2 kendala. Isinya berubah → peredamnya
lepas.

**F-4.** Kendala tanpa PIC yang lewat tenggat.

→ Barisnya berbunyi **"belum ada PIC"**, bukan dikosongkan. Baris tanpa
keterangan terbaca seperti sudah ada yang menangani.

**F-5.** Tutup semua kendala yang lewat tenggat. Tunggu putaran berikutnya.

→ Grup TIDAK menerima apa pun. Peringatan yang tetap datang saat tidak ada
apa-apa akan berhenti dibaca.

---

## G. Sumber terbaca benar

**G-1.** Buat satu kendala dari MASING-MASING pintu di bagian 0, lalu di papan
gunakan saringan **Sumber**.

→ Keempatnya terlabel benar: Dicatat langsung · Laporan harian · Kegiatan
lapangan · Ask MARLIN.

> Ini titik yang PALING perlu Anda periksa. Sampai 2026-08-20 dua di antaranya
> (Laporan harian, Ask MARLIN) diam-diam berlabel "Dicatat langsung" karena
> jalur pembuatannya tidak menulis sumbernya. Sudah diperbaiki dan dijaga uji,
> tapi ini persis jenis kesalahan yang tidak menerbitkan galat apa pun.

---

## Yang BELUM ada — jangan diuji, memang tidak ada

- **Menghapus kendala.** Belum ada sama sekali, termasuk untuk salah ketik.
- **Aksi massal** (tetapkan PIC/tenggat banyak kendala sekaligus).
- **Eskalasi bertingkat** (mis. lewat 14 hari → naik ke manajemen).
- **Membatalkan penggabungan** yang salah. Datanya tersimpan (`mergedIntoId`)
  sehingga secara teknis bisa, tapi tombolnya belum ada.
