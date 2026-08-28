# Untuk Manajemen

Bab ini untuk Project Manager, Area Manager, dan Direktur — yang **membaca angka**
dan memutuskan. Gambarnya diambil dari layar lebar, karena tabel mingguan dan
kurva-S memang tidak dimaksudkan dibaca di layar HP.

> Satu prinsip yang berlaku di seluruh MARLIN: **angka agregat selalu turunan**.
> Tidak ada satu pun kolom ringkasan yang bisa diketik manual. Kalau sebuah angka
> terlihat salah, yang salah ada di sumbernya — laporan harian, RAB, atau
> baseline — bukan di angka ringkasannya.

## 1. Beranda

Beranda menampilkan portofolio yang menjadi tanggung jawab Anda: berapa lokasi,
mana yang tertinggal, dan apa yang perlu diputuskan.

{{gambar:beranda}}

Apa yang Anda lihat dibatasi **peran** dan **penugasan**. Area Manager melihat
wilayahnya; Direktur melihat seluruh organisasi.

## 2. Membaca Progress satu lokasi

Tab **Progress** dipisah empat bagian. Yang pertama, **Ringkasan Progress**,
adalah tempat membaca — bukan mengubah.

{{gambar:progress-ringkasan}}

Cara membacanya:

| Yang dilihat | Artinya |
|---|---|
| Kurva rencana | Baseline yang berlaku — jadwal yang disepakati |
| Kurva realisasi | Yang benar-benar dilaporkan lapangan |
| Deviasi | Realisasi dikurangi rencana. Negatif = tertinggal |
| Prognosa | Perkiraan selesai berdasarkan laju terkini. **Estimasi tren, bukan kepastian** |

Prognosa baru muncul setelah ada realisasi minimal dua minggu. Sebelum itu tidak
ada laju yang bisa diproyeksikan, dan MARLIN memilih diam daripada menebak.

## 3. Mencari penyebab ketertinggalan

Bagian **Tertinggal & Kendala** menjawab pertanyaan berikutnya: *tertinggal di
mana, dan kenapa?*

{{gambar:progress-kendala}}

Bagian atas mengurutkan sepuluh item dengan **nilai kekurangan** terbesar — bukan
volume terbesar, melainkan rupiah yang paling berpengaruh ke kurva. Bagian bawah
adalah tempat mencatat kendala dan aksi pemulihannya, lengkap dengan PIC dan
target.

## 4. Memperbarui Kurva-S

Ini satu-satunya bagian di bab ini yang **mengubah data resmi**, dan ia sengaja
dibuat berbeda: berlencana peringatan, lima langkah bernomor, dan akibatnya
tertulis sebelum tombolnya.

{{gambar:perbarui-kurva-s}}

Alurnya:

1. **Unduh template** — berisi jadwal baseline yang sedang berlaku.
2. **Sunting di Excel** — ubah rentang atau bobot mingguannya. Kolom minggu boleh
   dikosongkan; itu berarti jeda.
3. **Unggah kembali** berkas yang sudah disunting.
4. **Periksa hasilnya** — MARLIN menghitung kurva barunya dan menunjukkan minggu
   mana saja yang berubah. **Sampai di sini belum ada satu pun angka resmi yang
   berubah.**
5. **Terapkan** — barulah menjadi baseline resmi baru.

Yang terjadi setelah diterapkan:

- Baseline lama **tidak dihapus** — ia jadi histori dan bisa dipulihkan.
- Realisasi lapangan yang sudah tercatat **tidak berubah sama sekali**.
- Deviasi dan prognosa berikutnya dihitung terhadap baseline baru.
- Siapa dan kapan tercatat di jejak audit.

> **Jangan mengunggah berkas RAB** atau Excel buatan sendiri. Hanya template yang
> diunduh dari halaman ini yang punya kolom minggu dan identitas pekerjaan yang
> bisa dibaca sistem.

## 5. Memakai Asisten Pengendalian

Asisten Pengendalian bukan tempat memasukkan angka baru. Ia membaca data yang
sudah ada di MARLIN, membantu menjelaskan kondisi, dan menyusun draf. Mulailah
dari kebutuhan, bukan dari nama mode:

1. Buka **Asisten Pengendalian → Tanya MARLIN**.
2. Pilih lokasi bila pertanyaan hanya untuk lokasi tertentu. Pilihan kosong
   berarti seluruh lokasi yang memang boleh Anda lihat.
3. Tulis pertanyaan dengan bahasa biasa, misalnya *“mana yang paling perlu saya
   kejar minggu ini dan apa buktinya?”*.
4. Buka sumber pada jawaban. **Cakupan bukti** menunjukkan berapa banyak bagian
   jawaban yang selamat dari pemeriksaan sumber; ini bukan tingkat kepastian
   ramalan AI.
5. Ajukan pertanyaan susulan tanpa mengulang semuanya. Percakapan terakhir ikut
   dibawa, tetapi izin lokasi selalu dihitung ulang.
6. Pilih **Buat laporan dari scope ini** bila jawabannya perlu menjadi keluaran
   kerja.

Alur laporan adalah: **draf → direview → disetujui → beku → dikirim**. Selama
belum beku, reviewer dapat mengedit judul, ringkasan, semua bagian, rekomendasi,
dan ringkasan WhatsApp. Setelah beku, isi tidak dapat diubah; perubahan harus
dibuat sebagai versi baru.

Artefak laporan dibuka sebagai **ringkasan satu pandangan**: kesimpulan 30
detik, lima indikator resmi, tiga lokasi prioritas, dan maksimal tiga keputusan
yang diminta. Gunakan bagian ini untuk briefing pimpinan. **Analisis pendukung**
disimpan tertutup sampai diperlukan; tabel lengkap tersedia di PDF dan lembar
**Angka Resmi** pada Excel. WhatsApp memakai urutan yang sama agar pesan dapat
dipahami tanpa membuka lampiran.

Tiga hal yang perlu dibaca sebagaimana adanya:

- Bila laporan harian belum masuk, laporan membuka dengan peringatan **jangan
  menilai kinerja fisik dulu** – di layar, PDF, Excel, maupun WhatsApp. Deviasi
  pada keadaan itu menunjukkan data yang belum masuk, bukan pekerjaan berhenti.
- Laporan hanya meminta **maksimal tiga keputusan**. Bila artefak lama memuat
  lebih banyak usulan, jumlah yang tidak ditampilkan disebutkan; buka **Edit
  seluruh laporan** untuk melihat atau menghapusnya.
- Setelah reviewer mengedit narasi, keterangan **cakupan bukti** berganti
  menjadi *narasi sudah diedit dan diverifikasi manusia*. Itu bukan penurunan
  mutu: rujukan sumber otomatis memang tidak lagi berlaku untuk kalimat yang
  ditulis manusia.

Pertanyaan yang berat butuh waktu. MARLIN mencatat pertanyaan Anda lebih dulu,
lalu menyusun jawabannya di latar: layar menampilkan **Sedang menyusun
jawaban…** beserta hitungan detik dan batas tunggunya. Halaman boleh
ditinggalkan – jawabannya tetap masuk ke percakapan yang sama, dan bisa dibaca
kapan saja lewat daftar **Percakapan**. Selama satu pertanyaan masih dijawab,
pertanyaan berikutnya di percakapan itu ditahan dulu.

Bila muncul **Jawaban sebelumnya tidak selesai**, prosesnya berhenti sebelum
jawaban tertulis – biasanya karena aplikasi dimuat ulang saat itu. Pertanyaannya
masih ada di layar; kirim ulang untuk mencoba lagi.

Jika jawaban menyatakan tidak punya sumber yang cukup, jangan memaksa AI
menjawab ulang dengan kalimat yang lebih meyakinkan. Periksa laporan harian,
baseline, kendala, atau sumber lain yang disebut belum tersedia.

### Bertanya melalui WhatsApp

Di chat pribadi, hanya nomor pengguna terdaftar yang dilayani. Di grup proyek,
mention MARLIN lalu tulis pertanyaan biasa. Pertanyaan rutin seperti *“progress
hari ini”* dijawab langsung dari calculation layer; pertanyaan terbuka dirangkai
dari snapshot dan catatan lapangan yang lolos pemeriksaan sumber.

MARLIN mengingat maksimal delapan giliran selama 30 menit untuk memahami
susulan. Ketik **“abaikan”** atau **“lupakan”** untuk melepas konteks. Riwayat
tidak pernah memperluas paket grup atau penugasan pengguna.
