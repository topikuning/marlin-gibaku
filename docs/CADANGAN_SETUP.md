# Cadangan MARLIN ke Google Drive

Database dan berkas MARLIN disalin rutin ke akun Google (Google One 2TB),
supaya data tidak hanya ada di Railway, R2, dan server Lenovo.
Keputusannya: [`docs/DECISIONS.md`](./DECISIONS.md) nomor 650.

| Apa | Kapan | Bentuk di Drive |
|---|---|---|
| Database | sekali sehari | `MARLIN Cadangan/database/marlin-db-<tanggal>-<jam>.dump.enc` – **tersandi** |
| Foto asli, foto ber-cap, dokumen, surat, lampiran | tiap jam, sedikit demi sedikit | `MARLIN Cadangan/berkas/<jenis>/<bulan>/…` – berkas apa adanya |

- Database disimpan 30 hari terakhir, ditambah cadangan pertama tiap bulan
  selama 12 bulan. Yang lebih lama dihapus otomatis.
- Berkas **tidak pernah** dihapus dari Drive, juga saat berkasnya dihapus di
  MARLIN.
- Berkas yang sekarang hanya ada di server Lenovo disalin paling dulu.
- Thumbnail, logo, kop, stempel, dan tanda tangan tidak ikut. Ukurannya kecil,
  semuanya tetap di R2, dan thumbnail bisa dibuat ulang.

---

## Memasang (sekali saja)

### 1. Pastikan fitur ini sudah ada di produksi
Fitur ini ikut rilis `main`. Sebelum di-merge, tombolnya belum ada di MARLIN
produksi, dan workflow cadangan di GitHub menjawab 404.

### 2. Isi kunci sandi di Railway
1. Pilih kuncinya. Ada dua pilihan:
   - **kalimat sandi buatan sendiri**, minimal 12 karakter. Makin panjang
     makin aman, misalnya satu kalimat yang mudah Anda ingat;
   - atau **kunci acak** yang ditampilkan kartu **Cadangan ke Google Drive**
     (MARLIN → Sistem → tab Integrasi) selama kuncinya belum diisi.
2. Railway → service MARLIN → **Variables** → **New Variable**:
   - Nama: `BACKUP_ENCRYPTION_KEY`
   - Isi: kalimat sandi atau kunci acak tadi
3. **Simpan juga kunci itu di luar Railway**, misalnya di pengelola sandi atau
   dicetak lalu disimpan. Kalau Railway hilang, cadangan database hanya bisa
   dibuka dengan kunci ini. Tanpa kunci, cadangannya tidak berguna.
4. Railway men-deploy ulang sendiri setelah variabel disimpan.

> Jangan pernah mengganti kunci ini setelah cadangan berjalan. Cadangan lama
> tetap memakai kunci lama. Kalau terpaksa mengganti, simpan kunci lama bersama
> tanggal penggantiannya.

### 3. Sambungkan akun Google 2TB
Syaratnya: client ID dan secret Google sudah terisi di kartu **Google Drive**
(yang dipakai menyetor laporan ke folder KKP). Kalau belum, ikuti
[`GDRIVE_SETUP.md`](./GDRIVE_SETUP.md) lebih dulu. Tidak ada pengaturan baru di
Google Cloud, karena alamat callback-nya sama.

1. Di kartu **Cadangan ke Google Drive**, tekan **Sambungkan akun Google**.
2. Masuk dengan **akun Google One 2TB**. Akun ini boleh berbeda dari akun
   folder KKP, boleh juga sama.
3. Kalau muncul *"Google belum memverifikasi aplikasi ini"*, tekan
   **Lanjutan** lalu **Buka … (tidak aman)**. Ini wajar untuk aplikasi milik
   sendiri yang belum diverifikasi Google.
4. Izinkan akses. MARLIN hanya meminta izin `drive.file`, jadi ia hanya bisa
   melihat berkas yang ia buat sendiri. Isi Drive Anda yang lain tidak
   terlihat olehnya.
5. Anda kembali ke Sistem dengan tulisan **Tersambung: <email>**.

> Aplikasi OAuth di Google Cloud **harus berstatus In production**. Kalau
> masih *Testing*, izinnya mati setiap 7 hari dan cadangan berhenti diam-diam.

### 4. Jalankan yang pertama, lalu periksa
1. Tekan **Cadangkan sekarang**.
2. Tunggu beberapa menit, lalu muat ulang halaman. Kartu **Database** harus
   menunjukkan jam barusan.
3. Tekan **Buka folder di Google Drive**. Di dalamnya ada folder `database`
   (satu berkas `.dump.enc`) dan `berkas` (bertambah tiap jam).

Salinan berkas pertama kali bisa makan beberapa hari, tergantung jumlah foto
dan kecepatan internet rumah tempat server Lenovo berada. Angka **Berkas
tercadangkan** di kartu itu menunjukkan kemajuannya.

### 5. Pastikan jadwalnya berjalan
Penjadwalnya workflow GitHub **Cadangan MARLIN ke Google Drive**
(`.github/workflows/cron-cadangan.yml`), tiap jam menit ke-10. Ia memakai
`APP_URL` dan `CRON_SECRET` yang sudah dipakai cron lain, jadi tidak ada
rahasia baru di GitHub.

GitHub → tab **Actions** → **Cadangan MARLIN ke Google Drive**: lingkaran hijau
tiap jam berarti berjalan. Tombol **Run workflow** di sana menjalankan satu
putaran tanpa menunggu.

### 6. Peringatan kalau cadangan macet
Peringatan WhatsApp memakai nomor dan sakelar yang sama dengan peringatan arsip
dingin (Sistem → tab Integrasi → **Arsip dingin berkas asli**). Peringatan
dikirim bila:
- database tidak tercadangkan lebih dari 36 jam,
- akun Google cadangan terputus, atau kuncinya hilang,
- ada antrean berkas, tapi tidak satu pun berhasil disalin dalam 24 jam.

Satu pesan per hari untuk keadaan yang sama. Pemeriksaan ini juga ikut tugas
harian MARLIN, jadi penjadwal GitHub yang mati total tetap ketahuan.

---

## Memulihkan database

Lakukan ini **sekali sekarang sebagai latihan**, ke database percobaan. Cadangan
yang belum pernah dicoba dipulihkan belum terbukti bisa dipakai.

1. Unduh satu berkas `marlin-db-….dump.enc` dari folder `MARLIN Cadangan/database`.
2. Buka sandinya (di komputer yang punya salinan repo ini):
   ```bash
   BACKUP_ENCRYPTION_KEY="<kunci dari langkah 2>" \
     pnpm tsx scripts/buka-cadangan.mts marlin-db-2026-10-05-0210.dump.enc marlin.dump
   ```
   Kunci salah atau berkas rusak = berhenti dengan pesan jelas, tidak pernah
   menghasilkan berkas setengah benar.
3. Pulihkan ke database **kosong** (Postgres 16 ke atas):
   ```bash
   pg_restore --no-owner --no-privileges --dbname="<DATABASE_URL tujuan>" marlin.dump
   ```
4. Arahkan `DATABASE_URL` MARLIN ke database itu bila memang memulihkan
   produksi.

## Memulihkan berkas

Berkas di `MARLIN Cadangan/berkas` tersimpan apa adanya, tidak tersandi.
- Nama berkas = kunci aslinya dengan `/` diganti `__`, misalnya
  `photos__karanggondang__2026-07-10__abc.jpg`.
- Kunci aslinya juga tertulis di **deskripsi** tiap berkas (Drive → klik kanan
  → **Info berkas**).

Untuk mengembalikan satu berkas, unggah ulang isinya ke R2 dengan kunci itu.
Belum ada skrip pemulih massal. Kalau dibutuhkan, minta dibuatkan; datanya
sudah cukup untuk itu.

---

## Keterbatasan yang perlu diketahui

- Cadangan ini **satu akun Google**. Kalau akun itu hilang atau terkunci,
  cadangan ikut tidak terjangkau. Aktifkan verifikasi 2 langkah di akun itu.
- Berkas yang dihapus atau diganti di MARLIN dalam satu jam sebelum putaran
  cadangan bisa tidak sempat tersalin.
- Salinan berkas dari server Lenovo memakai internet rumah tempat server itu
  berada.
