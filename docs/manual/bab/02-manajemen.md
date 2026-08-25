# Untuk Manajemen

Bab ini untuk Project Manager, Area Manager, dan Direktur – yang **membaca angka**
dan memutuskan. Gambarnya diambil dari layar lebar, karena tabel mingguan dan
kurva-S memang tidak dimaksudkan dibaca di layar HP.

> Satu prinsip yang berlaku di seluruh MARLIN: **angka agregat selalu turunan**.
> Tidak ada satu pun kolom ringkasan yang bisa diketik manual. Kalau sebuah angka
> terlihat salah, yang salah ada di sumbernya – laporan harian, RAB, atau
> baseline – bukan di angka ringkasannya.

## 1. Beranda

Beranda menampilkan portofolio yang menjadi tanggung jawab Anda: berapa lokasi,
mana yang tertinggal, dan apa yang perlu diputuskan.

{{gambar:beranda}}

Apa yang Anda lihat dibatasi **peran** dan **penugasan**. Area Manager melihat
wilayahnya; Direktur melihat seluruh organisasi.

## 2. Membaca Progress satu lokasi

Tab **Progress** dipisah empat bagian. Yang pertama, **Ringkasan Progress**,
adalah tempat membaca – bukan mengubah.

{{gambar:progress-ringkasan}}

Cara membacanya:

| Yang dilihat | Artinya |
|---|---|
| Kurva rencana | Baseline yang berlaku – jadwal yang disepakati |
| Kurva realisasi | Yang benar-benar dilaporkan lapangan |
| Deviasi | Realisasi dikurangi rencana. Negatif = tertinggal |
| Prognosa | Perkiraan selesai berdasarkan laju terkini. **Estimasi tren, bukan kepastian** |

Prognosa baru muncul setelah ada realisasi minimal dua minggu. Sebelum itu tidak
ada laju yang bisa diproyeksikan, dan MARLIN memilih diam daripada menebak.

## 3. Mencari penyebab ketertinggalan

Bagian **Tertinggal & Kendala** menjawab pertanyaan berikutnya: *tertinggal di
mana, dan kenapa?*

{{gambar:progress-kendala}}

Bagian atas mengurutkan sepuluh item dengan **nilai kekurangan** terbesar – bukan
volume terbesar, melainkan rupiah yang paling berpengaruh ke kurva. Bagian bawah
adalah tempat mencatat kendala dan aksi pemulihannya, lengkap dengan PIC dan
target.

## 4. Memperbarui Kurva-S

Ini satu-satunya bagian di bab ini yang **mengubah data resmi**, dan ia sengaja
dibuat berbeda: berlencana peringatan, lima langkah bernomor, dan akibatnya
tertulis sebelum tombolnya.

{{gambar:perbarui-kurva-s}}

Alurnya:

1. **Unduh template** – berisi jadwal baseline yang sedang berlaku.
2. **Sunting di Excel** – ubah rentang atau bobot mingguannya. Kolom minggu boleh
   dikosongkan; itu berarti jeda.
3. **Unggah kembali** berkas yang sudah disunting.
4. **Periksa hasilnya** – MARLIN menghitung kurva barunya dan menunjukkan minggu
   mana saja yang berubah. **Sampai di sini belum ada satu pun angka resmi yang
   berubah.**
5. **Terapkan** – barulah menjadi baseline resmi baru.

Yang terjadi setelah diterapkan:

- Baseline lama **tidak dihapus** – ia jadi histori dan bisa dipulihkan.
- Realisasi lapangan yang sudah tercatat **tidak berubah sama sekali**.
- Deviasi dan prognosa berikutnya dihitung terhadap baseline baru.
- Siapa dan kapan tercatat di jejak audit.

> **Jangan mengunggah berkas RAB** atau Excel buatan sendiri. Hanya template yang
> diunduh dari halaman ini yang punya kolom minggu dan identitas pekerjaan yang
> bisa dibaca sistem.
