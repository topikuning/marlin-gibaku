# Skenario uji tanya-jawab WhatsApp & AI — Fase A–F

Dibuat 2026-08-19 atas permintaan user: *"buatkan skenario dan contoh
pengecekan dari pekerjaanmu yang RAG fase A-F"*.

Ini **naskah uji manual** — yang Anda ketik, yang harus keluar, dan yang
dihitung GAGAL. Bukan ringkasan fitur. Setiap baris di bawah bisa dijalankan
sendiri tanpa membaca kode.

> **Catatan penting soal nama.** Di brief awal fase ini disebut "RAG". Yang
> akhirnya dibangun adalah **pencarian narasi berbasis teks penuh Bahasa
> Indonesia**, bukan embedding — alasannya di `DECISIONS 382` dan
> `DESAIN_FASE_F_PENCARIAN_NARASI.md`. Embedding (F3) **belum ada**, dan
> prasyaratnya (pgvector) belum tersedia di PostgreSQL yang diperiksa.

---

## 0. Persiapan

| Perlu | Cara memastikan |
|---|---|
| WAHA tersambung | Sistem → WhatsApp: sesi berstatus `WORKING` |
| Event `message` **dan** `message.ack` aktif di WAHA | Tanpa `ack`, status kiriman berhenti di "Diterima WAHA" selamanya |
| Grup paket tertaut | Paket → buka paket → kolom kanan → Grup WhatsApp paket berlencana **Terpasang** |
| Ada laporan harian berstatus `disetujui`/`final` | Pencarian catatan hanya melihat status itu |

Semua uji bisa dijalankan di **dua tempat**, dan hasilnya harus sejalan:

- **WhatsApp** — kirim ke grup paket (atau japri ke nomor MARLIN).
- **Ask MARLIN** di aplikasi — untuk melihat sitasi dan keyakinan yang di
  WhatsApp tidak ditampilkan.

Kalau sebuah jawaban benar di satu tempat tapi salah di tempat lain, **itu
temuan**, bukan perbedaan yang wajar.

---

## Fase A–B — kanal, identitas, lingkup

`DECISIONS 370, 371, 372`

### A-01 Satu grup hanya milik satu paket

1. Paket → paket lain → coba tautkan **ID grup yang sudah dipakai** paket
   pertama.
2. **Harus:** ditolak dengan sebutan paket mana yang sudah memilikinya.
3. **GAGAL kalau:** tersimpan diam-diam. Dua paket berbagi satu grup membuat
   paket mana yang menjawab ditentukan urutan baris — data paket A bisa
   terkirim ke grup paket B tanpa galat apa pun.

> Kalau produksi Anda sebelumnya punya grup ganda, migrasi sudah melepas yang
> kalah dan mencatat nilai lamanya. Lihat: Sistem → Audit → cari action
> `package.wa_group_auto_unlink`. Payload-nya memuat `waGroupId` lama dan cara
> memulihkannya.

### A-02 Lingkup jawaban = hak penanya, bukan isi grup

1. Minta seorang **Site Manager** yang hanya ditugaskan di 1 lokasi mengetik
   di grup paket: `progress hari ini`.
2. **Harus:** hanya lokasi dia yang muncul.
3. **GAGAL kalau:** muncul lokasi lain di paket yang sama.

### A-03 Antrean jawaban tahan mati listrik

1. Kirim pertanyaan, lalu **matikan** proses aplikasi sebelum balasan keluar.
2. Nyalakan lagi.
3. **Harus:** jawabannya tetap terkirim (pekerjaannya tersimpan di tabel
   antrean, bukan di memori).
4. **GAGAL kalau:** pertanyaannya hilang tanpa jejak.

---

## Fase C — pengiriman & status baca

`DECISIONS 374, 380`

### C-01 Status kiriman naik sampai "terkirim ke perangkat"

1. Kirim laporan mingguan ke grup (Paket → Komunikasi paket → **Kirim
   laporan**).
2. Buka Sistem → riwayat kiriman WA.
3. **Harus:** statusnya naik melewati tangga ini dalam hitungan detik:
   **Antre → Diterima WAHA → Terkirim → Sampai** (lalu **Dibaca** kalau ada
   yang membukanya).
4. **GAGAL kalau:** mentok di **Diterima WAHA** selamanya → **event
   `message.ack` belum diaktifkan di WAHA**. Ini bukan bug kode, dan sengaja
   TIDAK ditulis "Terkirim": "Diterima WAHA" cuma berarti WAHA menerima
   permintaannya, belum tentu sampai ke siapa pun.

### C-02 Nasib pengingat dibaca dari yang BENAR-BENAR dikirim

1. Lihat laporan "pengingat harian" di Sistem.
2. **Harus:** jumlah yang tertulis terkirim = jumlah baris outbox berstatus
   terkirim.
3. **GAGAL kalau:** angkanya diambil dari catatan yang dibuat **sebelum**
   pengiriman — itu menghitung niat, bukan hasil.

---

## Fase D — membaca pertanyaan

`DECISIONS 375, 376, 377, 378, 381`

### D-01 Pola jelas dijawab TANPA AI

Ketik satu per satu:

```
progress hari ini
laporan mingguan
siapa yang belum lapor hari ini
ada kendala apa
bantuan
```

**Harus:** semuanya terjawab. **Matikan penyedia AI** (Sistem → AI → kill
switch), lalu ulangi kelimanya.

**Harus:** kelimanya **tetap** terjawab — jalur deterministik tidak lewat AI
sama sekali.
**GAGAL kalau:** ada yang berubah jadi "layanan AI tidak merespons". Itu
berarti pola yang seharusnya deterministik ternyata dilempar ke model.

### D-02 Yang kabur DITAWARKAN, bukan ditebak

Ketik: `kendala minggu lalu`

**Harus:** balasan berisi dua pilihan bernomor, persis seperti ini:

```
"kendala minggu lalu" bisa saya baca dengan dua cara.
Maksud Anda yang mana?

1. Semua kendala yang DIBUKA minggu lalu
2. Kendala minggu lalu yang MASIH TERBUKA sekarang

Balas angkanya saja (mis. 1). Kalau bukan salah satunya, tulis ulang lebih lengkap.
Pilihan ini berlaku 12 menit, dan hanya untuk Anda.
```

> Kalimat pilihan ke-2 sempat berbunyi *"Kendala dari periode itu yang MASIH
> TERBUKA sekarang minggu lalu"* – periodenya terdampar di belakang kata
> "sekarang". Ketahuan justru saat menulis naskah ini, karena di sini
> balasannya ditulis apa adanya untuk dibaca orang, bukan diperiksa sebagai
> `toContain("MASIH TERBUKA")`. Sudah diperbaiki dan dijaga uji.

Lalu balas `1`. **Harus:** terjawab sesuai pilihan itu.

**GAGAL kalau:** MARLIN memilih sendiri salah satu tafsir tanpa bertanya.
Dua tafsir itu menghasilkan daftar yang berbeda, dan menebak berarti menjawab
pertanyaan yang tidak diajukan.

### D-03 Pilihan itu terkunci ke ORANG, bukan ke grup

1. Orang A mengetik `kendala minggu lalu` di grup (muncul tawaran).
2. **Orang B** membalas `1` di grup yang sama.
3. **Harus:** balasan B **tidak** dianggap menjawab tawaran milik A.
4. **GAGAL kalau:** B ikut menjawab pilihan A. Di grup ramai, angka "1" bisa
   berarti apa saja.

### D-04 Tawaran kedaluwarsa DIKATAKAN, bukan didiamkan

1. Munculkan tawaran, **tunggu lewat 15 menit**, lalu balas `1`.
2. **Harus:** ada balasan yang menyebut pilihannya sudah lewat dan
   mempersilakan bertanya lagi.
3. **GAGAL kalau:** diam. Penanya baru saja mengetik angka dan berhak tahu
   kenapa tidak terjadi apa-apa.

### D-05 Pertanyaan susulan menyambung konteks

```
progress di Kedung Mutih
kalau kemarin?
```

**Harus:** pertanyaan kedua dijawab untuk **Kedung Mutih**, periode kemarin —
tanpa bertanya balik lokasinya.

Lalu uji pagar arah sebaliknya:

1. Sebagai user yang **hanya** boleh melihat lokasi X, tanyakan sesuatu.
2. Minta orang lain (berhak lebih luas) bertanya di grup yang sama.
3. **Harus:** riwayat percakapan **tidak pernah** memperlebar lingkup siapa
   pun. Konteks menyimpan **nama** lokasi lalu mencocokkannya ulang dengan
   katalog yang boleh dilihat penanya saat itu.

### D-06 Nama daerah dikenali, dan yang ambigu ditanyakan

```
progress di Demak
```

Kalau "Demak" cocok sebagai **kecamatan** dan **kabupaten** sekaligus,
**harus** muncul:

```
Nama lokasinya belum pasti:

"Demak" bisa berarti: Kecamatan Demak (1 lokasi), Kabupaten Demak (4 lokasi)

Tolong sebut nama lengkapnya.
```

Jumlah lokasinya **harus ikut disebut** — tanpa angka itu kedua pilihan
terlihat sama saja.

### D-07 Angka dalam jawaban selalu punya sumber

Di **Ask MARLIN** (bukan WhatsApp), tanyakan sesuatu yang menyebut angka,
mis. `progress Kedung Mutih bulan ini`.

**Harus:**
- setiap angka yang muncul punya sitasi yang **bisa dibuka**;
- keyakinan yang ditampilkan **dihitung**, bukan dikarang model;
- kalau tidak ada satu pun klaim sah, keyakinan **0** dan bagian yang menyebut
  angka **dibuang**.

**GAGAL kalau:** ada angka mengambang tanpa sumber, atau keyakinan tinggi
padahal tidak ada klaim yang tervalidasi.

---

## Fase E — sumber data & pagar kapabilitas

`DECISIONS 379`

### E-01 Yang tidak berhak TIDAK menerima datanya

Ini uji paling penting di fase ini, dan paling mudah lolos kalau diperiksa
sambil lalu.

1. Login sebagai **Site Manager** (punya `ai.ask`, **tidak** punya
   `finance.view`).
2. Tanyakan sesuatu yang menyentuh uang, mis. `berapa nilai kontrak paket ini`.
3. **Harus:** angka keuangan **tidak ikut** ke dalam bahan yang dikirim ke
   model sama sekali.
4. **GAGAL kalau:** angkanya sampai ke model lalu model "diminta tidak
   menyebutkannya". Pagar yang mengandalkan kepatuhan model bukan pagar.

Cara memeriksanya tanpa membaca kode: buka Ask MARLIN → riwayat run → run
tersebut → kartu **"Sumber data"**. Untuk Site Manager, **tidak boleh ada satu
pun sumber keuangan** di daftar itu. Bandingkan dengan run pertanyaan yang
sama oleh Program Director — di situ sumber keuangan **harus** muncul.

> Catatan kejujuran: keterangan "sumber ini dilewati karena peran penanya"
> saat ini hanya masuk ke **prompt**, tidak ditampilkan di layar run. Jadi
> yang bisa Anda periksa dari UI adalah **ketiadaannya** di daftar sumber,
> bukan pernyataan eksplisit bahwa ia dilewati.

### E-02 Empat adapter terbaca

Sebagai role yang berhak penuh (mis. Program Director), pastikan jawaban bisa
menyentuh keempatnya: **kontrak**, **keuangan**, **RAB**, **milestone**.

---

## Fase F — pencarian catatan lapangan

`DECISIONS 382, 383, 384`

Ini bagian yang di brief disebut "RAG". Yang dijalankan: pencarian teks penuh
`indonesian` dengan **stemming**, bukan embedding.

### F-01 Pertanyaan "kenapa" akhirnya terjawab

Sebelum fase ini, ketiganya selalu berakhir "saya belum mengerti".

```
kenapa Kedung Mutih tertinggal?
masalah material di Demak bulan ini apa saja?
pernah ada masalah izin di lokasi mana?
```

**Harus:** balasan berisi kutipan catatan pelapor, tiap kutipan menyebut
**lokasi, jenis catatan, dan tanggal**, dan ditutup penanda:

> 📝 Ini KUTIPAN catatan pelapor, disalin apa adanya – termasuk angkanya.
> Bukan angka resmi hasil hitungan MARLIN.

**GAGAL kalau:** penanda itu hilang. Balasan WhatsApp di-screenshot dan
diteruskan ke PPK; tanpa penanda, "tenaga 8 orang" di dalam catatan terbaca
sebagai angka resmi MARLIN.

### F-02 Stemming bekerja

1. Pastikan ada laporan yang memuat kata **"pengecoran"**.
2. Ketik: `cor`
3. **Harus:** laporan itu ketemu. (`pengecoran` → `ecor`, `tertunda` →
   `tunda`, `terlambat` → `lambat`.)
4. **GAGAL kalau:** kosong — berarti pencarian kata biasa, bukan konfigurasi
   `indonesian`.

### F-03 Kalimat tanya utuh tidak membuatnya kosong

```
kenapa terlambat, hujan?
```

**Harus:** ada hasil. Kata dicarikan dengan **OR**, lalu diperingkat — bukan
AND. Kalau AND, catatan harus memuat "kenapa" DAN "lambat" DAN "hujan"
sekaligus; hampir tidak pernah ada.

**GAGAL kalau:** 0 hasil padahal jelas ada catatan hujan. Ini cacat nyata yang
pernah terjadi dan ketahuan dari uji, bukan dugaan.

### F-04 Laporan yang BELUM sah tidak pernah dikutip

1. Buat laporan harian berstatus **draft** yang memuat kata unik, mis.
   `uji-draft-jangan-muncul`.
2. Cari kata itu lewat WhatsApp.
3. **Harus:** tidak ketemu.
4. **GAGAL kalau:** ketemu. Menjawab dari laporan yang sedang diperbaiki
   berarti menyebarkan keterangan yang justru belum sah — dan yang sudah
   terkirim ke WhatsApp tidak bisa ditarik kembali.

### F-05 Koreksi benar-benar mencabut

1. Cari kata dari sebuah laporan `final` — pastikan ketemu.
2. **Ubah** teks laporan itu (hapus kata tadi, ganti kata lain).
3. Cari kata **lama**: **harus tidak ketemu**.
4. Cari kata **baru**: **harus ketemu**.
5. **GAGAL kalau:** yang lama masih ketemu. Menjawab dari kalimat yang sudah
   dicabut adalah kesalahan paling sulit terlihat — jawabannya tampak normal
   **dan** bersitasi.

### F-06 Lingkup lokasi tetap berlaku pada catatan

1. Dua lokasi punya catatan dengan kata kunci yang **sama persis**.
2. Sebagai user yang hanya berhak atas lokasi A, cari kata itu.
3. **Harus:** hanya catatan lokasi A. **Jumlah hasilnya** pun tidak boleh
   membocorkan keberadaan lokasi B — penyaringan terjadi di dalam query,
   bukan sesudah peringkat.

### F-07 Niat yang dikenali TIDAK dibajak

```
progress hari ini
```

**Harus:** dijawab sebagai progress (angka resmi), **bukan** sebagai kutipan
catatan. Pencarian catatan hanya berjalan di dua keadaan: niat tidak dikenali,
dan penyedia AI mati.

**GAGAL kalau:** pertanyaan berpola jelas ikut dijawab dengan kutipan.

### F-08 Pencarian mati ≠ WhatsApp mati

Ini pagar yang dipasang saat memeriksa risiko produksi (`DECISIONS 384`).

1. Kalau pencarian catatan gagal karena apa pun (mis. konfigurasi teks
   `indonesian` ternyata tidak ada di server produksi), **harus:** balasan
   kembali ke perilaku lama — "saya belum mengerti" atau "layanan AI tidak
   merespons".
2. **GAGAL kalau:** WhatsApp **diam sama sekali**. Jalur yang dulu selalu
   berhasil mengirim sesuatu tidak boleh berubah jadi jalur yang bisu.

Galatnya tetap tercatat di log server dengan awalan `[narasi]` — jadi
kerusakan yang sesungguhnya tetap terlihat, hanya tidak menjatuhkan balasan.

---

## Yang SENGAJA belum ada

Supaya tidak diuji lalu dilaporkan sebagai bug:

| Belum ada | Alasan |
|---|---|
| **Embedding / pgvector (F3)** | Hanya dikerjakan bila pencarian kata terbukti kurang pada pertanyaan nyata. Prasyaratnya pgvector, yang **tidak tersedia** di PostgreSQL yang diperiksa dan harus diverifikasi di Railway lebih dulu. |
| **Isi dokumen PDF dicari** | Butuh ekstraksi teks + OCR untuk hasil pindaian — proyek tersendiri dengan kegagalannya sendiri. |
| **Uang lewat WhatsApp & "belum tertagih"** | Pekerjaan keuangan ditunda atas permintaan user. |

---

## Cara melaporkan temuan

Sertakan **tiga** hal, karena tanpa ketiganya temuan tidak bisa ditelusuri:

1. **Persis** yang diketik (salin apa adanya, termasuk huruf besar-kecil).
2. **Persis** yang dibalas MARLIN (screenshot atau salin).
3. **Siapa** yang bertanya (peran + lokasi penugasannya) dan **di mana**
   (grup paket mana / japri / Ask MARLIN).

Untuk jawaban yang angkanya dicurigai salah, sebutkan juga **angka yang Anda
anggap benar dan dari mana Anda membacanya** — itu yang membedakan "MARLIN
salah hitung" dari "MARLIN menghitung hal yang berbeda dari yang Anda kira".
