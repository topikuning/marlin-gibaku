# Skenario uji laporan AI eksekutif

Dokumen ini menguji apakah laporan benar-benar dapat dipahami pimpinan dalam
sekali lihat. Semua pengujian dilakukan dari UI MARLIN; pengguna tidak perlu
menjalankan perintah atau konfigurasi setelah Railway selesai deploy.

## Prasyarat

- Tersedia sedikitnya tiga lokasi dengan rencana, laporan final, dan kendala
  yang berbeda.
- Penguji memiliki akses **Asisten Pengendalian**, review laporan, dan unduh.
- Untuk uji WhatsApp, sesi WAHA sudah berstatus tersambung dan tersedia satu
  kontak uji.

## E-01 — pemahaman 30 detik

1. Buka **Asisten Pengendalian → Buat laporan**.
2. Pilih **Ringkasan Eksekutif Portofolio**, periode, dan seluruh lokasi.
3. Buat laporan, lalu buka artefaknya.
4. Tanpa membuka **Analisis pendukung**, minta penguji menyebutkan status,
   jumlah lokasi, kelengkapan laporan, tiga prioritas, dan keputusan yang diminta.

**Lulus bila:** kelima jawaban ditemukan di panel pertama tanpa membaca tabel
panjang. Kesimpulan maksimal tampak sebagai paragraf singkat, bukan gabungan
seluruh bagian laporan.

**Gagal bila:** pengguna harus membuka detail, menggulir tabel, atau menebak
apa yang perlu diputuskan.

## E-02 — data kosong tidak ditafsirkan sebagai pekerjaan berhenti

1. Pilih periode/lokasi yang laporan finalnya di bawah 25% dari kewajiban.
2. Buat laporan dan buka pratinjau cetak.

**Lulus bila:** status menjadi **Data belum lengkap** dan peringatan meminta
pimpinan tidak menilai kinerja fisik dulu. Kelengkapan menampilkan jumlah final
dibanding jumlah yang diharapkan.

**Gagal bila:** status tetap **Kritis** hanya karena realisasi terlihat nol,
atau laporan menyatakan pekerjaan berhenti tanpa bukti.

## E-03 — prioritas bersifat exception-first

1. Siapkan satu lokasi tanpa laporan, satu lokasi dengan recovery overdue, dan
   satu lokasi dengan deviasi negatif.
2. Buat laporan portofolio.

**Lulus bila:** ketiganya tampil pada **3 prioritas utama**, disertai satu alasan
langsung dan angka kunci. Lokasi stabil tidak mendahului ketiganya.

## E-04 — keputusan dapat ditindaklanjuti

1. Periksa bagian **Keputusan yang diminta**.
2. Nilai setiap judul dengan pertanyaan: “dapatkah pimpinan menyetujui,
   menolak, atau menugaskan ini?”

**Lulus bila:** maksimal tiga butir, judul berbentuk tindakan konkret, dan
alasan menjelaskan urgensi/konsekuensi. Tidak ada butir generik seperti
“tingkatkan koordinasi” tanpa objek yang jelas.

## E-05 — paritas layar, PDF, Excel, dan WhatsApp

1. Catat lima KPI dan tiga lokasi prioritas dari layar artefak.
2. Buka **Pratinjau / Cetak (PDF)**.
3. Unduh Excel dan buka lembar pertama **Ringkasan Eksekutif**.
4. Review, setujui, bekukan, lalu kirim ke kontak WhatsApp uji.

**Lulus bila:** status, periode, total laporan, jumlah deviasi negatif, kendala,
recovery overdue, dan angka lokasi prioritas sama pada keempat kanal. Excel
terbuka pada ringkasan; tabel mentah berada di lembar **Angka Resmi**.

**Gagal bila:** ada kanal yang menghitung ulang, membulatkan berbeda, atau
menghilangkan keputusan.

## E-06 — WhatsApp dapat dipahami tanpa lampiran

1. Baca hanya pesan WhatsApp yang diterima.
2. Pastikan urutannya: **Kesimpulan 30 detik → Angka resmi → 3 prioritas →
   Keputusan yang diminta → Dasar analisis**.

**Lulus bila:** pesan tetap ringkas, maksimal tiga prioritas/keputusan/bagian
analisis, dan dapat dipakai untuk briefing tanpa membuka MARLIN.

## E-07 — edit manusia dan lifecycle tetap aman

1. Saat status draf, pilih **Edit seluruh laporan**.
2. Ubah kesimpulan, satu analisis pendukung, dan satu keputusan.
3. Simpan, lalu lakukan **review → setujui → beku**.
4. Coba mengedit lagi setelah beku.

**Lulus bila:** hasil edit tampil pada seluruh kanal, jejak edit tercatat, dan
artefak beku tidak dapat diedit. Pesan WhatsApp final menyebut sudah direview,
bukan draf AI.

## E-08 — deploy Railway tanpa tindakan operator

1. Deploy commit melalui Railway seperti biasa.
2. Tunggu deployment sehat tanpa membuka shell Railway.
3. Jalankan E-01 dari UI.

**Lulus bila:** aplikasi dan laporan baru dapat digunakan langsung. Tidak ada
langkah migrasi, seed, konfigurasi ulang, atau perintah manual yang diminta
kepada pengguna.

