# DECISIONS.md

Decision log · **append-only**. Setiap keputusan design/arsitektur/produk
yang di-lock, catat di sini dengan konteks + alasan + alternatif yang di-reject.

Format:
```
## DDD · YYYY-MM-DD · Keputusan Singkat

**Konteks**: kenapa harus mutuskan
**Keputusan**: apa yang dipilih
**Alternatif direject**: apa saja
**Konsekuensi**: side effect
**Bisa di-revisit**: kapan boleh review ulang
```

DDD = decision ID sequential.

## Penomoran: PENULIS TIDAK MEMILIH NOMOR

Tulis judulnya begini, tanpa nomor:

```
## (baru) · Judul keputusan (YYYY-MM-DD)
```

Nomornya diberikan **pemeriksa terakhir saat merge ke `dev`**, mengikuti urutan
masuk. Alasannya kejadian nyata 2026-08-29: dua agen bekerja bersamaan, keduanya
menambah entri, keduanya memilih 473 dan 474. Git tidak mengeluh — bagi git itu
cuma konflik teks biasa — dan yang tersisa dua keputusan berbeda bernomor sama,
sementara 21 komentar kode menunjuk "DECISIONS 473" tanpa cara tahu yang mana.
Cabang yang sama bahkan sudah pernah digeser sekali (470/471 → 473/474) lalu
tertabrak lagi.

Selama nomor dipilih penulis, tabrakan itu berulang tiap kali dua orang menulis
di hari yang sama. Diberikan saat merge, ia mustahil.

Dijaga `tests/unit/decisions-nomor.test.ts`: nomor tidak boleh kembar, urutannya
tidak boleh mundur, dan tidak boleh ada `(baru)` yang lolos merge.

Penjaga `(baru)` itu HANYA menggigit di `dev`/`main`. Di cabang penulis, `(baru)`
justru bentuk yang benar, jadi yang diperiksa di sana bentuk judulnya. Versi
pertamanya menolak `(baru)` di mana saja, dan itu membuat aturan ini melawan
gerbangnya sendiri: penulis disuruh menulis `(baru)`, lalu setiap PR yang
menambah keputusan otomatis merah. Terbukti pada dua cabang pertama sesudah
aturannya berlaku — yang satu menyiasati dengan memilih nomor sendiri, persis
yang hendak dicegah.

**Merujuk keputusan dari kode**: tulis nomornya SESUDAH ia diberikan. Kalau
komentarmu perlu menunjuk keputusan yang masih `(baru)`, sebut judulnya; nomornya
ditambahkan pemeriksa terakhir bersama penomorannya.

---

## Berkasnya dipecah: INDEKS di sini, ISI di `docs/decisions/`

Berkas ini tadinya memuat seluruh entri dan tumbuh jadi **1,5 MB / 566 entri**.
Instruksi di `CLAUDE.md` menyuruh tiap agen membacanya lebih dulu — dan menuruti
itu berarti menghabiskan ±425 ribu token sebelum satu baris kode pun dikerjakan.
Log yang terlalu mahal untuk dibaca berhenti menjadi log; ia jadi beban yang
dilewati diam-diam, dan keputusan yang tidak pernah dibaca sama saja dengan
keputusan yang tidak pernah ditulis.

Sekarang: **indeks ini** (judul + tanggal, ±60 KB) yang dibaca lebih dulu, dan
arsip per seratus nomor di `docs/decisions/` hanya dibuka kalau nomornya sudah
diketahui. Tidak satu pun keputusan dibuang — 563 entri pindah utuh, judul dan
urutannya dibuktikan sama.

### Menambah keputusan baru

1. Tulis entrinya di **arsip nomor tertinggi** (`docs/decisions/501-600.md`),
   judulnya `## (baru) · Judul (YYYY-MM-DD)` — tetap **tanpa memilih nomor**.
2. Pemeriksa terakhir memberi nomornya saat merge, lalu menambahkan **satu
   baris** ke tabel di bawah.
3. Nomor melewati kelipatan seratus ⇒ arsip baru (`601-700.md`), dan bagian
   barunya ditambahkan di indeks ini.

Dijaga `tests/unit/decisions-nomor.test.ts`: nomor unik, urutannya tidak mundur,
tidak ada `(baru)` yang lolos merge, **dan setiap entri di arsip punya barisnya
di indeks ini** — indeks yang ketinggalan sama menyesatkannya dengan entri yang
hilang.

---

## Indeks keputusan (terbaru di atas)

### [501-600](./decisions/501-600.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 565 | 2026-09-12 | Bolak-balik adendum dijaga UTUH lewat basis data, bukan per potongan |
| 564 | 2026-09-12 | Persetujuan empat mata menyebut yang berhasil, bukan hanya yang kurang |
| 563 | 2026-09-12 | Induk baris DITULIS di template adendum, tidak ditebak dari lineageKey |
| 562 | 2026-09-12 | Nilai kategori template adendum menjumlahkan item bersarang |
| 561 | 2026-09-12 | Identitas template adendum dipakai APA ADANYA, tidak ditebak ulang |
| 560 | 2026-09-11 | DECISIONS dipecah: indeks yang dibaca, arsip yang dibuka seperlunya |
| 559 | 2026-09-11 | Kerusakan arsip ditangani sendiri; peringatan hanya untuk yang butuh orang |
| 558 | 2026-09-10 | "Sudah masuk belum?" dijawab dengan bertanya ke mesinnya, bukan membaca catatan sendiri |
| 557 | 2026-09-10 | Batas jumlah lokasi memotong daftar, bukan menolak menjawab |
| 556 | 2026-09-10 | Nama lokasi yang tertulis tidak boleh lenyap jadi "seluruh katalog" |
| 555 | 2026-09-10 | Header Cloudflare Access wajib di SEMUA jalur keluar, termasuk pemeriksaan kesehatan |
| 554 | 2026-09-10 | MARLIN bicara dialek gateway yang sudah berjalan, bukan sebaliknya |
| 553 | 2026-09-10 | Uji sambungan mengenali lawan bicaranya sebelum mengirim |
| 552 | 2026-09-10 | "Sudah tersambung belum?" dijawab tombol, bukan dugaan |
| 551 | 2026-09-10 | Penerima arsip dingin ikut dikirim, bukan diserahkan sebagai spesifikasi |
| 550 | 2026-09-10 | Gerbang keamanan & lisensi merah di main, plus penelusur Next 16.3 |
| 549 | 2026-09-09 | Arsip dingin berkas asli: R2 tetap persinggahannya, tanpa Railway Volume |
| 548 | 2026-09-09 | "Yatim" harus berarti benar-benar tidak dipakai |
| 547 | 2026-09-09 | HEIC iPhone dibongkar dekoder sendiri, bukan disimpan mentah |
| 546 | 2026-09-09 | Isi penyimpanan R2 diperiksa dan dibersihkan dari LAYAR, bukan terminal |
| 545 | 2026-09-09 | Baris tersembunyi disebut satu per satu, bukan cuma dihitung |
| 544 | 2026-09-07 | Impor ditolak bila yang akan disimpan ≠ yang dibaca dari berkas |
| 543 | 2026-09-07 | Baris induk berharga: nilainya dihitung, anaknya naik jadi saudara |
| 542 | 2026-09-07 | Kategori yang DINOLKAN adendum tetap diimpor, bukan dibuang |
| 541 | 2026-09-07 | Blok hasil CCO = blok BERIKUTNYA sesudah tambah/kurang, bukan yang paling kanan |
| 540 | 2026-09-07 | Label di sampul bukan header tabel; bacaan yang mustahil ditolak |
| 539 | 2026-09-07 | Balon keterangan lokasi dipasang sekali, lalu dipindahkan |
| 538 | 2026-09-06 | Bawaan penanda peta (berkelompok / satu per satu) diatur di layar Sistem |
| 537 | 2026-09-06 | Pengelompokan penanda bisa dimatikan; hilangnya pilihan lapisan dikatakan |
| 536 | 2026-09-06 | Peta di layar HP: legenda tidak menumpang, halaman peta satu panel |
| 535 | 2026-09-06 | Bingkai awal peta = kotak lokasi, bukan seluruh Indonesia |
| 534 | 2026-09-06 | Worker MapLibre disajikan sendiri — akar peta abu-abu yang sebenarnya |
| 533 | 2026-09-06 | Koordinat janggal di impor katalog DITOLAK dan dilaporkan, bukan ditebak |
| 532 | 2026-09-06 | Peta dasar tinggal di VOLUME, sumbernya bisa diketik, dan isinya diperiksa sebelum dipakai |
| 531 | 2026-09-06 | Peta pindah ke MapLibre GL JS + peta dasar milik sendiri |
| 530 | 2026-09-06 | Katalog lokasi dirampingkan: hanya kolom yang dipakai MARLIN |
| 529 | 2026-09-06 | Arsip pencabutan lokasi (super admin), menu lingkup pindah ke tab Lokasi, pencarian penugasan melebar |
| 528 | 2026-09-06 | Katalog lokasi dari MASTER DATA KNMP: aktif saja, tanpa data perusahaan, bisa disunting di tempat + peta |
| 527 | 2026-09-05 | Adendum boleh MENAMBAH dan MENCABUT lokasi — ditandai, bukan dihapus |
| 526 | 2026-09-05 | Halaman paket: kurva-S gabungan + adendum berjalan yang terlihat |
| 525 | 2026-09-05 | Dokumen CCO memakai harga BERKAS untuk sisi CCO-01, dan KET bukan tebakan dari volume nol |
| 524 | 2026-09-05 | Sel bercampur huruf bukan angka, dan tabel RAB berakhir di blok tanda tangan |
| 523 | 2026-09-05 | Perapian bahasa hanya di form EDIT — bukan di form buat, bukan di finalisasi |
| 522 | 2026-09-05 | Lapisan layar penuh lewat satu pintu, dan keluar dari kurungan induknya |
| 521 | 2026-09-04 | Asal nilai ditandai WARNA, tidak lagi ditulis |
| 520 | 2026-09-04 | Layar galat MENJELASKAN, bukan cuma menyebut |
| 519 | 2026-09-04 | Penjaga kegagalan transport tidak lagi opsional: seluruh layar lewat `useAksi` |
| 518 | 2026-09-04 | Audit keamanan CI tidak boleh menuduh: endpoint yang diam ≠ kerentanan |
| 517 | 2026-09-03 | Pratinjau adendum menampilkan SELURUH beda, bukan delapan teratas |
| 516 | 2026-09-03 | Perapian bahasa jadi alat tulis, bukan syarat finalisasi – dan judul prompt tidak boleh ikut tersalin |
| 515 | 2026-09-03 | CI menjalankan job yang PERLU saja, dan "perlu" itu diuji |
| 514 | 2026-09-03 | Batas ukuran foto dikatakan SEBELUM diunggah, dan memilih foto selalu terlihat |
| 513 | 2026-09-03 | Kontainer menyiapkan volumenya sendiri, lalu melepas hak root |
| 512 | 2026-09-03 | Mode periode minggu punya kapabilitas sendiri; Project Manager boleh mengubahnya |
| 511 | 2026-09-03 | Label periode laporan mengikuti jenis yang DIPILIH, bukan yang sedang tampil |
| 510 | 2026-09-03 | Aktivasi adendum tidak boleh kehabisan waktu karena ukurannya |
| 509 | 2026-09-03 | Daftar paket menyebut nilai kontrak, bukan cuma pagunya |
| 508 | 2026-09-03 | Direktori lokasi menyebut perusahaan pelaksana dan realisasinya, deviasi tidak lagi menonjol |
| 507 | 2026-09-03 | Laporan harian menyesuaikan volume baru saat adendum DIAKTIFKAN |
| 506 | 2026-09-03 | Pemetaan manual TIDAK menambah volume, dan itu dikatakan sebelum dipilih |
| 505 | 2026-09-03 | Kategori pada pemetaan manual dikenali lewat NAMA, bukan nomor romawinya |
| 504 | 2026-09-03 | Panel harga menuntut DUA syarat: harganya beda, DAN bedanya memindahkan rupiah |
| 503 | 2026-09-03 | Pemetaan manual dipesan lebih dulu untuk SELURUH pohon |
| 502 | 2026-09-02 | Volume adendum negatif ditolak, dan HAPUS tidak menuntut ejaan persis |
| 501 | 2026-09-02 | Σ item yang terbaca diadu dengan total yang ditulis berkas |

### [401-500](./decisions/401-500.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 500 | 2026-09-02 | Berkas CCO terbitan MARLIN bisa diimpor ulang |
| 499 | 2026-09-02 | Satu pembaca angka untuk seluruh jalur impor Excel |
| 498 | 2026-09-02 | Kolom SATUAN tidak lagi terbaca sebagai kolom HARGA SATUAN |
| 497 | 2026-09-02 | Peringatan harga diam saat tidak ada rupiah yang berpindah |
| 496 | 2026-09-01 | Dua tanda tangan tetap wajib; pengusul boleh mengisi salah satunya |
| 495 | 2026-09-01 | Batas 10% adalah plafon SATU KONTRAK yang dibagi antar lokasi |
| 494 | 2026-09-01 | Adendum yang sah menaikkan laporannya menjadi resmi |
| 493 | 2026-09-01 | Kategori baru menggugurkan tanda tangan seperti mutasi lain |
| 492 | 2026-09-01 | Pagar realisasi draft adendum membaca basis yang benar |
| 491 | 2026-09-01 | Draft adendum terikat pada lokasi pemiliknya |
| 490 | 2026-09-01 | Peringatan adendum berbunyi pada rupiah yang berpindah, bukan pada selisih desimal |
| 489 | 2026-09-01 | Identitas item RAB dikenali dari pekerjaannya, bukan dari nomor urutnya |
| 488 | 2026-09-01 | Impor RAB tidak lagi mengandaikan kolom NO ada di kolom A |
| 487 | 2026-08-31 | Di grup, hanya mention langsung yang dilayani |
| 486 | 2026-08-31 | Kronologi dirapikan AI, dan tiap lokasi punya kesimpulan 2–3 kalimat |
| 485 | 2026-08-31 | Kronologi masuk AI Intelligence sebagai jenis run, bukan sebagai layar tersendiri |
| 484 | 2026-08-31 | Kronologi lokasi: kendala dan kegiatan lapangan sebagai satu cerita |
| 483 | 2026-08-30 | Lokasi itu direktori, Progress itu papan tagihan |
| 482 | 2026-08-30 | Kolom RAPL mengikuti keputusan yang sedang diminta; ringkasannya berhenti mengulang |
| 481 | 2026-08-30 | Layout kolom tersimpan tidak boleh menyembunyikan kolom baru |
| 480 | 2026-08-30 | Layar menunggu dengan menengok status, bukan menarik ulang halaman |
| 479 | 2026-08-30 | MarlinGrid membuka satu pintu imperatif: melepas pilihan |
| 478 | 2026-08-30 | Ketukan baris membuka panel di layar, bukan di bawah lipatan |
| 477 | 2026-08-29 | RAPL punya pintunya sendiri; penahanan menu Keuangan berhenti di menu Keuangan |
| 476 | 2026-08-29 | RAPL-01…RAPL-08 dikerjakan: AI di latar, dan RAPL memecah RAB per item |
| 475 | 2026-08-29 | Audit menu RAPL: AI-nya lambat karena polanya, dan AHSP diam-diam jadi gerbang |
| 474 | 2026-08-29 | Setiap keputusan laporan eksekutif harus menyebut fokusnya |
| 473 | 2026-08-29 | Waktu verifikasi mengikuti saat diperiksa, bukan tanggal laporannya |
| 472 | 2026-08-29 | Lampiran WA: disk dulu, R2 hanya yang ditetapkan, sisanya kedaluwarsa |
| 471 | 2026-08-29 | Lampiran WA diarsipkan saat ditangkap, bukan saat ditetapkan |
| 470 | 2026-08-29 | Tenggat KKP: berkas mingguan naik pukul 23, grup ditagih pukul 18 |
| 469 | 2026-08-29 | "Buat laporan" akhirnya benar-benar membuat laporannya |
| 468 | 2026-08-29 | Tujuh temuan review 2026-08-29 ditutup |
| 467 | 2026-08-28 | Lampiran WhatsApp: tangkap ganda ditutup, dan berkasnya bisa dibuka |
| 466 | 2026-08-28 | Empat temuan review kedua ditutup |
| 465 | 2026-08-28 | Rahasia di AppSetting: satu aturan, dan yang lama ikut ditutup |
| 464 | 2026-08-28 | `BOOTSTRAP_DEMO_DATA` akhirnya punya penjaga |
| 463 | 2026-08-28 | Seed demo memakai struktur RAB lapangan, identitas diganti |
| 462 | 2026-08-28 | Perintah natural dipahami sebagai perintah, dan tafsirnya ditulis |
| 461 | 2026-08-28 | Perbaikan temuan audit kesehatan 2026-08-28 |
| 460 | 2026-08-28 | Empat cacat DECISIONS 458/459 ditutup setelah review |
| 459 | 2026-08-28 | Cakupan AI didaftar & ditegakkan; lapisan pengendalian ikut terjawab |
| 458 | 2026-08-28 | Progres harian vs mingguan dibedakan, dan pertanyaan "mau ngapain" punya jawabannya |
| 457 | 2026-08-27 | Blanko harian berhenti meluber, lampiran foto mengalir dua kolom, jejak unggah terjadwal tercatat |
| 456 | 2026-08-27 | Tiga kelemahan rombakan AI ditutup: latar tahan restart, galat tidak bocor, requestIp presisi |
| 455 | 2026-08-27 | Ask MARLIN dijawab di latar, bukan di dalam request |
| 454 | 2026-08-27 | Batas format eksekutif ditegakkan, sisanya disebut bukan dibuang |
| 453 | 2026-08-27 | Laporan AI memakai executive brief satu pandangan |
| 452 | 2026-08-27 | Asisten Pengendalian: percakapan, bukti, artefak penuh, dan WA luwes |
| 451 | 2026-08-27 | Sampul laporan harian mengikuti mode minggu kontrak, juga saat final |
| 450 | 2026-08-27 | Register kendala: satu baris per lokasi, kembar dibuang |
| 449 | 2026-08-26 | "progress 5 terbaik" akhirnya berbeda dari "progress hari ini" |
| 448 | 2026-08-26 | Jawaban WhatsApp berdaftar panjang dikirim sebagai PDF |
| 447 | 2026-08-26 | Tiga cacat produksi WhatsApp: balasan pribadi, log ganda, disk lampiran |
| 446 | 2026-08-26 | `DATABASE_URL` bentuk SQLAlchemy dirapikan, bukan ditolak |
| 445 | 2026-08-26 | Isian `@lid` DIBUANG – manusia hanya tahu nomor WA |
| 444 | 2026-08-26 | Nomor di balik `@lid` ditanyakan ke WAHA, lintas engine |
| 443 | 2026-08-26 | Alasan MARLIN DIAM di WhatsApp ditampilkan |
| 442 | 2026-08-26 | Impor Kurva-S: berkas ikut ke langkah "Terapkan" |
| 441 | 2026-08-26 | RAPL menjadi workspace estimasi biaya; AI hanya mengusulkan HSD |
| 440 | 2026-08-26 | Lampiran berkas terbaca LINTAS ENGINE WAHA |
| 439 | 2026-08-26 | Pagar nomor pribadi jadi SATU ARAH |
| 438 | 2026-08-26 | Blanko harian: logo dua pihak setara, isi kotak dipusatkan |
| 437 | 2026-08-26 | Surat bisa dibatalkan – reversibel, ber-alasan, tanpa hapus permanen |
| 436 | 2026-08-26 | Register surat: berkas benar-benar tersimpan, duplikat ditahan, paket ikut dari lokasi |
| 435 | 2026-08-26 | Jalur PDF per provider AI, diverifikasi ke SDK resmi |
| 434 | 2026-08-26 | Unggah surat + pemetaan AI SEKALI JALAN; lokasi berdiri sendiri |
| 433 | 2026-08-25 | Kalender harian tidak loncat ke atas; kiriman WA ke nomor pribadi dimatikan |
| 432 | 2026-08-25 | Penangkap lampiran grup WA + register surat masuk/keluar |
| 431 | 2026-08-25 | Jarak form auth: spasi tidak boleh menumpang komponen yang bisa hilang |
| 430 | 2026-08-25 | Blanko final lama: rentang periode dibekukan surut, penyaji tidak lagi memakai mode berjalan |
| 429 | 2026-08-25 | Default mode periode minggu = SENIN–MINGGU, kontrak lama dikonversi otomatis |
| 428 | 2026-08-25 | Rombak workspace Chat Grup + kurasi relevansi manual |
| 427d | 2026-08-24 | Ganti mode minggu = SATU KLIK: jadwal lama dikonversi, bukan dibuang |
| 427c | 2026-08-24 | Snapshot blanko final: weekNo mode-aware + rentang periode dibekukan |
| 427b | 2026-08-24 | Generator kurva-S otomatis sadar-grid minggu |
| 427 | 2026-08-24 | Wakil Sah, mode periode minggu, cap galeri "apa adanya", logo pengawas |
| 426 | 2026-08-24 | Pengendalian Terpadu: temuan, inspeksi, verifikasi eksternal; Wakil PPK jadi VERIFIKATOR |
| 425 | 2026-08-23 | Batas foto sekali unggah: 6 → 20, dan yang tidak muat DISEBUT |
| 424 | 2026-08-23 | Foto Cepat: orientasi & logo perusahaan di cap |
| 423 | 2026-08-23 | Adendum: derau pembulatan & letak item |
| 422 | 2026-08-23 | Paparan: ingatkan + minta konfirmasi bila lingkup & minggu itu sudah punya deck |
| 421 | 2026-08-23 | Project Manager & Area Manager memegang pekerjaan KONTRAK NORMAL |
| 420 | 2026-08-23 | Paparan juga bisa dibuat PER LOKASI |
| 419 | 2026-08-23 | Site Manager boleh mengisi penanda tangan LOKASI |
| 418 | 2026-08-23 | Foto paparan: PDF gagal di produksi, pratinjau pecah, keterangan tak terbaca |
| 417 | 2026-08-22 | Paparan KKP dirombak mengikuti contoh Mataram + Action Plan digenerate |
| 416 | 2026-08-22 | Paparan Mingguan Kontrak KKP (deck PDF 16:9) |
| 415 | 2026-08-22 | Pindah tanggal laporan harian (super admin) |
| 414 | 2026-08-22 | Ketukan tanggal harus TERLIHAT hasilnya: pop-up, bukan panel di luar layar |
| 413 | 2026-08-22 | Sidebar bisa diringkas |
| 412 | 2026-08-22 | Stempel menutupi teks di PDF: urutan menggambar, bukan ukuran |
| 411 | 2026-08-22 | Menu Keuangan ditahan: SEMENTARA super_admin saja |
| 410 | 2026-08-22 | Kolom stempel pelaksana dihapus, sesudah dipastikan kosong |
| 409 | 2026-08-22 | Konsultan Pengawas per LOKASI, bukan per paket |
| 408 | 2026-08-22 | Satu perusahaan, satu stempel; dan grid yang mengukur jendela padahal hidup di dalam laci |
| 407 | 2026-08-21 | Kendala hari nihil dan kendala lembar kirim: double entry, bukan satu |
| 406 | 2026-08-21 | Tab Laporan lokasi: yang ditanyakan orang adalah "sudah sampai ke Drive/WA belum" |
| 405 | 2026-08-21 | Tombol "Pasang aplikasi" di dalam MARLIN, bukan di menu ⋮ Chrome |
| 404 | 2026-08-21 | Pelaksana Lapangan bukan warga istimewa: satu formulir dengan penanda tangan lain |
| 403 | 2026-08-21 | Kurva-S di DALAM laporan mingguan adalah laporan mingguan |
| 402 | 2026-08-21 | Pelaksana Lapangan meneken laporan harian & mingguan |
| 401 | 2026-08-21 | `pending` yang tidak pernah menyala: sebab sesungguhnya di balik tiga keluhan yang sama |

### [301-400](./decisions/301-400.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 400 | 2026-08-21 | Keluhan yang sama untuk KEDUA kalinya: aksi yang diklik tidak mengaku sedang bekerja |
| 399 | 2026-08-21 | Mode pesawat: Foto Cepat siap TANPA pernah dibuka lebih dulu |
| 398 | 2026-08-21 | Aplikasinya sendiri bisa dibuka tanpa sinyal: service worker, bukan aplikasi Android |
| 397 | 2026-08-21 | Lampiran foto PDF: barisnya mengalir, bukan satu baris per lembar |
| 396 | 2026-08-20 | Hari tanpa kegiatan: pernyataan, bukan pelonggaran pagar |
| 395 | 2026-08-20 | Cetak laporan harian KKP: empat cacat tata letak, semuanya struktural |
| 394 | 2026-08-20 | Menghapus kendala salah catat: sempit, wajib beralasan, atomik dengan jejaknya |
| 393 | 2026-08-20 | Menggabungkan kendala kembar, dan penjaga statis untuk pembacanya |
| 392 | 2026-08-20 | Satu pusat kendala: `/kendala`, pemilik, penjaga duplikat, penagih |
| 391 | 2026-08-20 | "Item tertinggal" dibandingkan terhadap JADWAL ITEM, bukan kurva-S global |
| 390 | 2026-08-20 | Enam cacat tanya-jawab WhatsApp yang dilaporkan user dari PRODUKSI |
| 389 | 2026-08-20 | Koreksi naskah uji: lingkup jawaban ditentukan KANAL, bukan orangnya |
| 388 | 2026-08-19 | Tab Dokumen ikut rombak |
| 387 | 2026-08-19 | Naskah uji manual WA-AI + label pilihan yang bisa dibaca |
| 386 | 2026-08-19 | Halaman Paket dirombak: ringkasan untuk KEPUTUSAN, form sesekali ke drawer |
| 385 | 2026-08-19 | Tanda pisah teks UI: en-dash (–), bukan em-dash (—) |
| 384 | 2026-08-19 | Indeks narasi jadi INDEKS EKSPRESI, bukan kolom tersimpan |
| 383 | 2026-08-19 | Pencarian narasi TERSAMBUNG ke WhatsApp |
| 382 | 2026-08-19 | Fase F1+F2: pencarian narasi lapangan + kutipan verbatim |
| 381 | 2026-08-19 | "Kendala minggu lalu" DITAWARKAN, bukan dipilihkan |
| 380 | 2026-08-19 | Nasib pengingat harian dibaca dari outbox, bukan dari catatan pra-kirim |
| 379 | 2026-08-19 | Adapter sumber: kontrak, keuangan, RAB, milestone — dipagari kapabilitas |
| 378 | 2026-08-19 | Klaim TERIKAT + keyakinan deterministik + sitasi yang bisa dibaca |
| 377 | 2026-08-19 | Pertanyaan susulan disambung dari konteks, bukan ditanya balik |
| 376 | 2026-08-19 | Klarifikasi tertunda: pilihan yang benar-benar bisa dijawab |
| 375 | 2026-08-19 | Parser niat deterministik: yang jelas dijawab tanpa AI, yang kabur ditawarkan |
| 374 | 2026-08-19 | Gateway pengiriman WhatsApp + rekonsiliasi `message.ack` |
| 373 | 2026-08-19 | Migrasi grup ganda MEMBERESKAN sendiri; pemulihan deploy diperbaiki |
| 371 | 2026-08-19 | Satu resolver kanal + identitas + scope; Super Admin & Program Director dilayani di mana pun |
| 370 | 2026-08-19 | Satu grup WhatsApp = satu paket |
| 369 | 2026-08-19 | Progress historis WhatsApp & AI Hub: `asOf` diteruskan |
| 368 | 2026-08-19 | Paket & Katalog Lokasi dirombak; katalog pindah ke Master Data |
| 367 | 2026-08-19 | Tanya-jawab WA mengenali nama DAERAH, bukan cuma nama lokasi |
| 366 | 2026-08-19 | Kartu KPI dashboard ikut dimampatkan |
| 365 | 2026-08-19 | Buku manual: screenshot DIBANGKITKAN, bukan ditempel |
| 364 | 2026-08-18 | "Perbarui Kurva-S" jadi alur resmi, bukan tombol yang berserak |
| 363 | 2026-08-18 | Progress lokasi: memantau dipisah dari mengatur |
| 362 | 2026-08-18 | Rencana & RAB dipisah SUB-TAB, bukan ditumpuk |
| 361 | 2026-08-18 | Kartu KPI diperkecil di primitifnya |
| 360 | 2026-08-18 | Menu berkas: aksi yang berjalan harus terlihat, dan tombolnya mati |
| 359 | 2026-08-18 | Master data memakai rancangan baru: ringkasan, temuan, laci |
| 358 | 2026-08-18 | "Laporan mingguan" dijawab laporan harian, dan salah label |
| 357 | 2026-08-17 | Laporan mingguan WA: minggu yang dilaporkan bisa dipilih |
| 356 | 2026-08-17 | Chat WhatsApp jadi luwes: periode bebas + niat baru |
| 355 | 2026-08-17 | Sel kalender KOSONG membuka inputan langsung |
| 354 | 2026-08-17 | Tab lokasi melekat, dan tarik-untuk-muat-ulang dimatikan |
| 353 | 2026-08-17 | Site Manager boleh mengubah kurva-S (baseline) |
| 352 | 2026-08-17 | Overflow mobile berulang: pagarnya menyapu daftar yang ditulis tangan |
| 351 | 2026-08-17 | Di grup, penanya tidak perlu terdaftar: lingkup ditentukan GRUPNYA |
| 350 | 2026-08-17 | Nomor pasangan `@lid` ada di `key.remoteJidAlt` |
| 349 | 2026-08-17 | Mention di grup tidak pernah dikenali: MARLIN tak mengenal dirinya sendiri |
| 348 | 2026-08-17 | Satu chat, satu tulisan: kanonikalisasi chat id WhatsApp |
| 347 | 2026-08-17 | Chat pribadi ber-identitas `@lid` tidak pernah terjawab |
| 346 | 2026-08-17 | Nomor WhatsApp ditampilkan apa adanya (`…@c.us`) di kolom pengguna |
| 345 | 2026-08-17 | Nomor pengirim WhatsApp tidak pernah cocok; diam pun tak berjejak |
| 344 | 2026-08-17 | Sumber foto di baris material/alat diringkas jadi sepertiga |
| 343 | 2026-08-17 | Foto material/alat ikut simpanan: tiga sumber langsung di barisnya |
| 342 | 2026-08-17 | Enter menyimpan, "Diterima" jadi Qty/Volume, dan foto tak lagi menagih simpan dulu |
| 341 | 2026-08-17 | Tata letak input harian: sumber foto, foto material, dan kendala |
| 340 | 2026-08-17 | Pelaksanaan Harian jadi kalender: seluruh riwayat, bukan 14 hari |
| 339 | 2026-08-17 | Tanya-jawab WhatsApp bebas: dari izin sampai jawaban |
| 338 | 2026-08-17 | Tanya-jawab WhatsApp bebas: izin dikerjakan lebih dulu |
| 337 | 2026-08-17 | /hari-ini dikembalikan jadi alat kerja pelaksana |
| 336 | 2026-08-16 | /hari-ini: strip 7 hari, matriks, dan dua bentuk untuk dua pengguna |
| 335 | 2026-08-16 | Berkas mingguan ikut jalur WhatsApp & Drive; tombol ganda dibersihkan |
| 334 | 2026-08-16 | Satu tombol per BERKAS, tujuannya di dalam menu |
| 333 | 2026-08-16 | Stempel dikurung di dalam blok tanda tangannya |
| 332 | 2026-08-16 | Berkas mingguan: satu sampul, tujuh laporan harian |
| 331 | 2026-08-16 | Tanda tangan tidak pernah sampai ke PDF: `Buffer` vs `ArrayBuffer` |
| 330 | 2026-08-16 | Acuan ukuran stempel salah sejak awal: lebar kolom, bukan tinggi celah |
| 329 | 2026-08-16 | Letak stempel dikoreksi: menimpa teks, bukan mengambang di ruang kosong |
| 328 | 2026-08-16 | Tabel RAPL pindah ke MarlinGrid; tanda tangan & stempel ditempel di dokumen cetak |
| 327 | 2026-08-16 | Harga Satuan Dasar, biaya RAPL, dan RAPL yang keluar dari layar |
| 326 | 2026-08-16 | RAPL disusun ulang: per URAIAN, bertahap |
| 325 | 2026-08-16 | Impor AHSP kehabisan memori di server 512 MB — dan diam-diam mengaku sukses |
| 324 | 2026-08-16 | Basis AHSP terbitan 5.0-universal: diperiksa dulu, baru dipakai |
| 323 | 2026-08-16 | Ganti terbitan AHSP menghapus 954 pemetaan secara senyap — BUG |
| 322 | 2026-08-16 | Unduh kebutuhan RAPL: berkasnya membawa cakupannya sendiri |
| 321 | 2026-08-16 | Lapisan istilah AHSP: aturan pencocokan datang dari berkasnya |
| 320 | 2026-08-16 | Persetujuan borongan + simulasi kebutuhan RAPL |
| 319 | 2026-08-16 | Pemetaan RAB → AHSP tersimpan: mesin memetakan, manusia memperbaiki |
| 318 | 2026-08-16 | Pencocokan RAB → AHSP: otomatis, tapi mengaku saat ragu |
| 317 | 2026-08-16 | Basis data AHSP SE DJBK 47/2026 sebagai sumber koefisien |
| 316 | 2026-08-15 | Rincian Time Schedule sampai level ITEM |
| 315 | 2026-08-15 | Super admin UTAMA ditetapkan dari variabel lingkungan |
| 314 | 2026-08-15 | Penolakan proteksi akun jadi PESAN, bukan layar error |
| 313 | 2026-08-13 | Unggah OTOMATIS laporan ke Drive KKP lewat antrean berlaju |
| 312 | 2026-08-13 | Pemilih lokasi ikut dipasang di baris identitas ponsel |
| 311 | 2026-08-12 | Laporan Progres Mingguan otomatis + manual ke grup WhatsApp |
| 310 | 2026-08-12 | Identitas baris dikunci di kiri pada daftar lokasi |
| 309 | 2026-08-08 | Uji yang mematok tanggal skenario wajib mematok jamnya juga (2026-08-08 → |
| 308 | 2026-08-08 | Template adendum: "boleh diketik" adalah sifat KOLOM, bukan sifat baris |
| 307 | 2026-08-08 | Uji tidak boleh menunggu keadaan yang dirancang untuk lenyap |
| 306 | 2026-08-08 | Kabar "tersimpan" tidak boleh dibunuh oleh pemasangan ulang form |
| 305 | 2026-08-08 | Rana Foto Cepat tidak lagi aktif sebelum kameranya benar-benar siap |
| 304 | 2026-08-08 | Material & alat: foto per baris, halaman cetak sendiri, dan hari tanpa item pekerjaan |
| 303 | 2026-08-07 | Foto dokumentasi bisa diklik ke gambar penuh, tanpa gambarnya disentuh |
| 302 | 2026-08-07 | Site Manager bisa masuk ke halaman adendum yang aturannya sudah menunjuk dia |
| 301 | 2026-08-07 | Cetak harian LENGKAP di kedua jalur, dan final tidak lagi kehilangan fotonya |

### [201-300](./decisions/201-300.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 300 | 2026-08-07 | Kop sampul: terang, lengkap, dan berlogo di kedua pihak |
| 299 | 2026-08-07 | Laporan harian KKP: sampul + halaman dokumentasi pekerjaan |
| 298 | 2026-08-07 | Combobox tidak boleh memotong pilihan, dan Foto Cepat ada di form kegiatan |
| 297 | 2026-08-07 | Baca sheet yang diperlukan saja, dan yang tidak disembunyikan |
| 296 | 2026-08-07 | Berkas tambah/kurang KKP dibaca apa adanya |
| 295 | 2026-08-07 | Form impor RAB ikut dijaga, dan berkas salah disebut namanya |
| 294 | 2026-08-07 | "07.00" bukan jam, dan koordinat cadangan bukan bukti |
| 293 | 2026-08-07 | Judul foto = pekerjaan yang dibuktikannya |
| 292 | 2026-08-07 | Tab yang lebih tua daripada servernya |
| 291 | 2026-08-07 | Pengiriman yang gagal harus bisa diulang, bukan menghapus isian |
| 290 | 2026-08-07 | Halaman yang runtuh di sisi peramban harus menyebut nama galatnya |
| 289 | 2026-08-07 | Galat server action tidak boleh menjatuhkan halaman |
| 288 | 2026-08-07 | Foto Cepat: empat lapis supaya byte yang hilang tidak lagi berarti bukti hilang |
| 287 | 2026-08-07 | Antrean foto: berhenti menuduh jaringan tanpa bukti |
| 286 | 2026-08-07 | Antrean foto: simpan BYTE, bukan Blob — sebabnya akhirnya diketahui |
| 285 | 2026-08-07 | Antrean foto: satu koneksi IndexedDB, nama galat apa adanya, panel rincian di layar |
| 284 | 2026-08-07 | Antrean foto: hentikan menebak — simpanan yang gagal harus BERSUARA |
| 283 | 2026-08-07 | Antrean foto: tidak ada batas waktu di mana pun — antreannya bisa mati diam-diam |
| 282 | 2026-08-07 | Antrean foto: baris yang kehilangan halamannya tersangkut selamanya |
| 281 | 2026-08-07 | Foto yatim: bisa dihapus (bug trigger), dan bisa dipakai lagi |
| 280 | 2026-08-07 | Foto Cepat di laporan harian: panel menutup, kantong bisa dipilih sebelum item ada |
| 279 | 2026-08-06 | Papan status harian: saringan DIKEMBALIKAN, grid tinggal jadi tabelnya |
| 278 | 2026-08-06 | Tautan "Buka Drive" menunjuk BLANKO laporan, bukan berkas terakhir |
| 277 | 2026-08-06 | Papan status harian jadi GRID; tandanya sendiri yang jadi tombol |
| 276 | 2026-08-06 | Papan status harian: saringan lokasi/Drive/WA + perbaikan luapan mobile |
| 275 | 2026-08-06 | Dasar rencana SELALU baseline yang aktif — `asOf` tidak lagi memilih versi |
| 274 | 2026-08-06 | Batas `asOf` = AKHIR hari kerja, bukan awalnya |
| 273 | 2026-08-06 | Baris aksi foto di laporan harian: satu baris, warna dibawa TITIK |
| 272 | 2026-08-06 | Foto kantong bisa diambil DARI layar laporan harian & kegiatan lapangan |
| 271 | 2026-08-06 | Kantong Foto Cepat: SETIAP foto bisa dipilih, dan lokasi ditetapkan per-pilihan |
| 270 | 2026-08-06 | Foto Cepat: kamera jadi SATU LAYAR PENUH, tanpa gulir |
| 269 | 2026-08-06 | Kop laporan Excel berlogo: pemilik pekerjaan & kontraktor |
| 268 | 2026-08-06 | Kategori kurva-S dijodohkan lewat `lineageKey`, bukan nama |
| 267 | 2026-08-06 | Yang menandatangani rencana mingguan adalah penanda tangan KONTRAK, bukan operator aplikasi |
| 266 | 2026-08-06 | FMT-01 selesai: satu konvensi desimal untuk seluruh blanko |
| 265 | 2026-08-06 | Workbook laporan periodik mengikuti berkas KKP: COV-BQ, REKAP, harga, tanda tangan |
| 264 | 2026-08-06 | Kop laporan: milik PERUSAHAAN, MARLIN cuma alatnya |
| 263 | 2026-08-06 | Ringkasan harian dirapatkan, fotonya ditautkan, lokasi disebut lengkap |
| 262 | 2026-08-06 | Papan status laporan harian — satu tanggal, semua lokasi, beserta jejak Drive |
| 261 | 2026-08-06 | Laporan harian RINGKAS — dokumen bacaan untuk grup WA, bukan blanko KKP |
| 260 | 2026-08-06 | Pengingat harian punya SAKELAR, dan sakelarnya berhenti di batas yang benar |
| 259 | 2026-08-05 | Rencana mingguan dikirim ke WhatsApp — pesannya MEMUAT rencana, bukan cuma lampiran |
| 258 | 2026-08-05 | Rencana mingguan punya KELUARAN dan bisa DINILAI sebelum dijalankan |
| 257 | 2026-08-05 | Foto Cepat tahan sinyal jelek: simpan dulu di HP, kirim dari antrean |
| 256 | 2026-08-05 | Rana dipindah ke dalam aplikasi — jepret, masuk, jepret lagi |
| 255 | 2026-08-05 | Foto Cepat KAMERA SAJA — jalur galeri dibuang |
| 254 | 2026-08-05 | Lokasi foto dideteksi dari geotag — dan MENOLAK menebak |
| 253 | 2026-08-05 | Foto Cepat — jepret dulu, itemnya belakangan |
| 252 | 2026-08-05 | Parser RAB: subtotal terhitung sebagai pekerjaan, judul kategori hilang |
| 251 | 2026-08-05 | Kunci ketukan ulang navigasi punya UJUNG, bukan 20 detik |
| 250 | 2026-08-04 | Status foto DITURUNKAN dari laporan/kegiatan, bukan kolom sendiri |
| 249 | 2026-08-04 | Nomor paket bisa dikoreksi sesudah berkontrak |
| 248 | 2026-08-04 | Kolom "Nomor" di daftar paket jatuh ke nomor kontrak |
| 247 | 2026-08-04 | "Klik lokasi, tidak terjadi apa pun" — tiga cacat menumpuk di satu ketukan |
| 246 | 2026-08-04 | Tampilan sesudah login terpotong: penyebabnya di halaman SEBELUMNYA |
| 245 | 2026-08-04 | Umpan balik navigasi: yang rusak bukan kecepatannya, tapi diamnya |
| 244 | 2026-08-03 | Advisory keamanan transitif: override PER LINI, bukan rentang terbuka |
| 243 | 2026-08-03 | Nama penanda tangan CCO diisi dari kontrak |
| 242 | 2026-08-03 | Pengaman "sudah terprogres" dibawa ke DALAM berkas Excel |
| 241 | 2026-08-03 | Excel laporan harian mengikuti blanko yang sama dengan PDF |
| 240 | 2026-08-03 | Batas 25 lokasi dicabut; pemilih lokasi bisa dipakai pada skala nyata |
| 239 | 2026-08-03 | Dokumen CCO jadi berkas HIDUP (formula, bukan angka mati) |
| 238 | 2026-08-03 | Pemilih berkas bergaya sendiri; Activity Centre menaut ke kegiatannya |
| 237 | 2026-08-03 | CCO dirapikan; aksi jadi tombol (lagi) |
| 236 | 2026-08-03 | Ekspor dokumen CCO format KKP |
| 235 | 2026-08-03 | Warna pin peta ≠ status lapor; daftar "sudah submit" akhirnya ada |
| 234 | 2026-08-03 | Aktivasi adendum butuh DUA orang; super admin tidak termasuk |
| 233 | 2026-08-03 | Batas 10% Perpres mengukur kenaikan NILAI KONTRAK, bukan pekerjaan tambah kotor |
| 232 | 2026-08-03 | Aksi jadi tombol; tujuan impor mengikuti keadaan |
| 231 | 2026-08-03 | EXIF cacat menjatuhkan unggahan; fokus melompat saat "Tambah foto" |
| 230 | 2026-08-02 | `fieldset` melebarkan halaman; sapuan overflow menyapu keadaan termudah |
| 229 | 2026-08-02 | Foto: menambah bukan menimpa, batas 8→25 MB, fokus tidak berbohong |
| 228 | 2026-08-02 | "Sengaja dikosongkan" ≠ "belum diatur" pada branding |
| 227 | 2026-08-02 | Wordmark resmi + kepala cap sejajar + alur isi ponsel |
| 226 | 2026-08-02 | Alur isi cepat laporan harian + foto menyusul |
| 225 | 2026-08-02 | Saklar "foto galeri tanpa GPS →" dibuang |
| 224 | 2026-08-02 | Cap foto memakai lockup resmi apa adanya; panel perusahaan berhenti sebelum lockup |
| 223 | 2026-08-02 | Logo resmi MARLIN dipasang; cap foto berhenti memakai tiruan |
| 222 | 2026-08-02 | ID pesan WAHA bukan bukti sampai |
| 221 | 2026-08-02 | "Berhasil" yang tidak mengirim apa pun: nol pesan harus menjelaskan dirinya |
| 220 | 2026-08-02 | Unggah galeri: tanya dulu "sedang di lokasi?", baru tentukan koordinat |
| 219 | 2026-08-02 | Izin GPS diurus di depan + dicatat; wajib-GPS berlaku juga untuk galeri |
| 218 | 2026-08-02 | Jenjang peran = superset, pemisahan tugas jadi setelan, cap foto menyebut bangunan |
| 217 | 2026-08-02 | Overflow mobile dijaga uji, bukan audit manual |
| 216 | 2026-08-02 | Template kerja adendum: unduh dari RAB aktif, isi volume, impor balik |
| 215 | 2026-08-02 | Baris basis draft adendum TIDAK dicetak di blanko harian KKP |
| 214 | 2026-08-02 | Blanko harian KKP: realisasi dikelompokkan per bangunan/kategori |
| 213 | 2026-08-02 | Harga satuan item kontrak lama terkunci; bergeser = peringatan, bukan diam |
| 212 | 2026-08-02 | Ekspor Excel RAB: Jumlah item angka mati, bukan ROUND(volume×harga) |
| 211 | 2026-08-02 | Angka resmi disaring basis aktif di SEMUA jalurnya, bukan hanya progres |
| 210 | 2026-08-02 | Progres atas draft adendum: satu laporan, dua basis |
| 209 | 2026-08-02 | Impor Excel ke DRAFT adendum, dengan diff sebelum disimpan |
| 208 | 2026-08-02 | Kode RAB dari negosiasi resmi dipakai apa adanya; ekspor bisa diimpor ulang |
| 207 | 2026-08-02 | Tombol admin tidak dikunci + dialog konfirmasi yang tidak pernah mengirim |
| 206 | 2026-08-02 | "Terkirim 7" padahal nol sampai: status sesi WA wajib diperiksa |
| 205 | 2026-08-01 | Penjadwal via GitHub Actions + tombol pengingat manual admin |
| 204 | 2026-08-01 | Dua jalan buntu navigasi: kartu antrean & pindah lokasi |
| 203 | 2026-08-01 | Impor jadwal Excel: angka user DIIKUTI apa adanya |
| 202 | 2026-08-01 | Penjadwal harian: SPMK terjadwal + pengingat WA laporan harian |
| 201 | 2026-08-01 | Daftar lokasi di dalam paket ikut penugasan |

### [101-200](./decisions/101-200.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 200 | 2026-08-01 | Ganti peran akun |
| 199 | 2026-08-01 | Peran Wakil PPK: baca saja, tanpa AI, sesuai penugasan |
| 198 | 2026-08-01 | Perbaikan cap foto + pengelolaan arsip berkas asli |
| 197 | 2026-08-01 | Cap foto hanya boleh menyatakan apa yang benar-benar diketahui + arsip berkas asli |
| 196 | 2026-08-01 | Output AI harus punya isi: sections/rekomendasi ikut terkirim, status jujur soal data kosong |
| 195 | 2026-08-01 | "Draft saran" tidak lagi jalan buntu: bisa diterapkan jadi Kendala nyata |
| 194 | 2026-08-01 | Eksekusi doktrin 193: Laporan → WA dilebur ke Report Studio + jembatan run & Ask |
| 193 | 2026-08-01 | Doktrin AI Intelligence: mesin analisis & produksi artefak, bukan fitur visual/chatbot |
| 192 | 2026-07-31 | Buka kunci final yang buntu, cuaca/tenaga kerja yang tersembunyi, dan tombol Kembali cetak yang nyasar |
| 191 | 2026-07-31 | Impor Drive tidak lagi menawarkan balik berkas terbitan MARLIN sendiri |
| 190 | 2026-07-31 | Executive View ikut butuh penugasan lokasi |
| 189 | 2026-07-31 | Koordinat lokasi: satu aturan, satu tempat mengeditnya, dan tidak lagi hilang diam-diam |
| 188 | 2026-07-31 | Katalog lokasi: pencocokan ke Location riil diperbaiki; aturan Combobox dijaga lint |
| 187 | 2026-07-30 | Koreksi susunan lokasi paket berkontrak: jalur super admin, BUKAN adendum |
| 186 | 2026-07-30 | WAHA: perbaikan penarikan daftar grup + verifikasi nama grup saat simpan ID |
| 185 | 2026-07-30 | Scope PAKET: yang tidak ditugaskan tidak tampil; workspace dijaga di query |
| 184 | 2026-07-30 | Impor dokumen dari folder Google Drive KKP |
| 183 | 2026-07-30 | Dokumen bisa dikoreksi & dibatalkan; namanya diturunkan dari data |
| 182 | 2026-07-30 | Larangan mengarang ditegaskan di SEMUA prompt |
| 181 | 2026-07-29 | Penjaga perapian teks MENANDAI, bukan memblokir (koreksi user) |
| 180 | 2026-07-29 | Sistem → Prompt AI: satu halaman mengatur teks perintah SEMUA aksi AI |
| 179 | 2026-07-29 | Perapian teks kegiatan dipindah ke SAAT FINALISASI (menggantikan pola tombol per-field 178) |
| 178 | 2026-07-29 | "Rapikan dengan AI" untuk teks bebas kegiatan lapangan (usulan, bukan penulisan otomatis) |
| 177 | 2026-07-29 | Pemilih cuaca MANUAL dimatikan (bisa dihidupkan lagi) + penegasan: cuaca mengikuti TANGGAL LAPORAN |
| 176 | 2026-07-29 | Cuaca laporan harian: kondisi PER JAM dari koordinat lokasi (bukan satu kategori sehari) |
| 175 | 2026-07-29 | Impor RAB: kolom NEGOSIASI gagal terdeteksi pada 2 varian header (nilai kontrak terbaca = pagu HPS) |
| 174 | 2026-07-29 | Ekspor RAB tampilan profesional + TUNTASKAN aturan Combobox (kritik user) |
| 173 | 2026-07-29 | Adendum lengkap: grid Excel-like, link CCO, review aktivasi, ekspor Excel 3 sheet |
| 172 | 2026-07-29 | Adendum RAB tahap (a): editor draft di aplikasi, bukan hanya Excel |
| 171 | 2026-07-28 | Badge nama pekerjaan pada cap foto dijamin muat |
| 170 | 2026-07-28 | Foto laporan harian bisa dihapus selama laporan masih draft |
| 169 | 2026-07-28 | Utang uji TEST-01 dibayar dengan PostgreSQL sungguhan |
| 168 | 2026-07-28 | Audit uang & status ditulis DI DALAM transaksinya |
| 167 | 2026-07-28 | Migrasi WAJIB idempoten + preDeploy memulihkan migrasi gagal |
| 166 | 2026-07-28 | Identitas pemilik pekerjaan (nama + logo) pindah ke menu Sistem |
| 165 | 2026-07-28 | Model deployment single-tenant + snapshot as-of + proteksi akun |
| 164 | 2026-07-28 | Eksekusi audit Codex: tenancy P0 ditutup di jalur aplikasi |
| 163 | 2026-07-28 | Nama hari ganda diperbaiki di sumber + mesin rencana harian |
| 162 | 2026-07-27 | Satu format dokumen: unduh layar & kiriman WhatsApp ikut blanko KKP |
| 161 | 2026-07-27 | PDF laporan mingguan/bulanan ke Drive = blanko resmi KKP |
| 160 | 2026-07-27 | Sheet Laporan: identitas tidak terpotong + angka terhitung jadi rumus |
| 159 | 2026-07-27 | Penyesuaian halus kurva-S ikut menyetel jadwal kategori |
| 158 | 2026-07-27 | Baris rencana kurva-S kembali RUMUS (membatalkan penguncian B3 di Excel) |
| 157 | 2026-07-27 | Kolom Bobot kurva-S = SUM kolom minggu; sebaran wilayah dashboard = populasi peta |
| 156 | 2026-07-27 | Laporan mingguan: Excel tertaut ke rincian + header tabel blanko KKP |
| 155 | 2026-07-27 | Eksekusi P1/P2 audit total — keuangan best-practice, konsistensi angka, guard, UI |
| 154 | 2026-07-27 | Eksekusi P0 audit total (B1, B2, B4, B6, B9, B8, UI-konfirmasi) |
| 153 | 2026-07-27 | Tindak lanjut audit independen + dokumentasi dirapikan |
| 152 | 2026-07-27 | Calculation Integrity Protocol dijalankan atas kode |
| 151 | 2026-07-27 | Satu formula prestasi untuk laporan, kurva-S, dan dashboard |
| 150 | 2026-07-27 | Manajemen Kontak terpadu + fix kebocoran kontak lintas-tenant |
| 149 | 2026-07-27 | Buka kunci laporan final untuk koreksi (super_admin saja) |
| 148 | 2026-07-27 | Tombol "Bangun ulang snapshot" (bukan skrip, bukan revert final) |
| 147 | 2026-07-27 | Fix: kumulatif snapshot laporan harian tidak dibatasi tanggal |
| 146 | 2026-07-27 | Upload Drive memperbarui file (revisi), bukan menumpuk kembar |
| 145 | 2026-07-27 | Laporan harian ke Drive memakai BLANKO KKP, bukan ringkasan |
| 144 | 2026-07-27 | Rute folder Drive lewat MILESTONE (bukan hanya jenis dokumen) |
| 143 | 2026-07-27 | Struktur 9 folder KKP di Drive + foto & kegiatan lapangan ikut |
| 142 | 2026-07-26 | Fix: redirect URI OAuth Google dipaksa https (di balik proxy) |
| 141 | 2026-07-26 | Upload laporan ke Google Drive folder KKP (per paket) |
| 140 | 2026-07-26 | Fix: urutan kategori tabel Kurva-S KKP tidak ikut urutan RAB |
| 139 | 2026-07-26 | Chat Grup jadi workspace analisis + siklus hidup ringkasan |
| 138 | 2026-07-26 | Identitas pengirim chat grup — ringkasan menyebut ORANG, bukan kode |
| 137 | 2026-07-26 | Ringkasan chat grup: kiriman MARLIN tertangkap, konteks paket, filter noise, distribusi |
| 136 | 2026-07-26 | Narasi lapangan (laporan harian + kegiatan) jadi konteks AI Hub |
| 135 | 2026-07-26 | Ringkasan harian chat grup (Layer B) + menu Master Data + kop surat |
| 134 | 2026-07-26 | Kontak WA mandiri · master data perusahaan & lokasi · peta auto-fit |
| 133 | 2026-07-26 | AI Intelligence Hub (menu global /ai) |
| 132 | 2026-07-26 | Forecast v1 — Prognosa penyelesaian (jadwal/fisik) |
| 131 | 2026-07-26 | Kegiatan: satukan Cetak+PDF jadi satu, rincian PDF 2 kolom |
| 130 | 2026-07-26 | Rombak UI/UX halaman Kegiatan & Dokumentasi Lapangan |
| 129 | 2026-07-26 | Fix render PDF: foto kosong, teks tumpang tindih, kotak tofu |
| 128 | 2026-07-26 | Fix produksi #2: pdfkit "Cannot find module" → vendor bundle di assets/ |
| 127 | 2026-07-26 | Fix produksi: pdfkit gagal muat di Railway (pakai bundle self-contained) |
| 126 | 2026-07-26 | Laporan Harian & Mingguan/Bulanan → PDF ringkas + kirim WA |
| 125 | 2026-07-26 | Foto di PDF: link publik MARLIN ke gambar penuh (tak ter-crop) |
| 124 | 2026-07-26 | Kirim Laporan Kegiatan sebagai PDF (server-side) ke WhatsApp |
| 123 | 2026-07-26 | Laporan Kegiatan Lapangan → PDF (dokumen A4 rapi: teks + foto) |
| 122 | 2026-07-26 | Laporan Eksekutif → WA (rangkuman AI dikirim ke direksi) |
| 121b | 2026-07-26 | Pilihan model AI dari sumber kredibel (kurasi + live /models) |
| 121 | 2026-07-26 | Multi-provider AI (Claude/OpenAI/Mistral/Grok) + pemilih aktif |
| 120 | 2026-07-26 | Rombak halaman /sistem → hub Pengaturan 5-tab (Slice 1) |
| 119 | 2026-07-25 | Tangkap percakapan grup WhatsApp (Layer A) — webhook WAHA → arsip per paket |
| 118 | 2026-07-25 | Revisi RAB = adendum HANYA setelah SPMK (bukan sekadar revisi ke-2) |
| 117 | 2026-07-25 | Seragamkan nama lokasi (buang prefix "KNMP") + edit nama lokasi |
| 116 | 2026-07-25 | Edit nama pengguna · batas 32 foto/kegiatan · jam dari nama file WhatsApp |
| 115 | 2026-07-25 | Jenis kegiatan lapangan jadi MASTER DATA + semua dropdown pakai Combobox |
| 114 | 2026-07-25 | Impor rekap laporan harian dari Excel (backfill saat lapangan lupa lapor) |
| 113 | 2026-07-25 | Pelaksana mendarat langsung di "Hari Ini" (bukan Beranda) |
| 112 | 2026-07-25 | Tagging waktu foto: fix timezone EXIF + metadataSource + penanda "waktu unggah" |
| 111 | 2026-07-25 | Menu "Foto Lapangan" — galeri foto lintas lokasi |
| 110 | 2026-07-25 | Photo stamp: tata letak mengikuti master layout referensi |
| 109 | 2026-07-25 | Fix upload >1MB gagal (500 digest) — proxyClientMaxBodySize |
| 108 | 2026-07-25 | Dashboard Eksekutif jadi beranda peran manajemen + gabung Command Center |
| 107 | 2026-07-25 | Rombak /aktivitas → "Dashboard Eksekutif" (layout mockup, data nyata) |
| 106 | 2026-07-25 | Upload dokumen: batas 25MB + MIME toleran + pesan R2 jelas (403 = Cloudflare WAF, di luar kode) |
| 105 | 2026-07-25 | Dashboard "Aktivitas & Denyut Lokasi" (eksekutif) — feed lintas lokasi + progress per lokasi |
| 104 | 2026-07-25 | Export TS: baris realisasi PENUH rumus (kumulatif + sumber grafik) seperti rencana |
| 103 | 2026-07-25 | Jadwal kategori = MATRIKS bobot per-minggu (mendukung minggu TERPUTUS/jeda) |
| 102 | 2026-07-25 | Export Time Schedule: sumber grafik TERTAUT rumus (edit → grafik ikut update) |
| 101 | 2026-07-25 | Tag lokasi foto sadar-sumber (Kamera vs Galeri) — perbaiki batch galeri |

### [001-100](./decisions/001-100.md)

| # | Tanggal | Keputusan |
|---|---|---|
| 100 | 2026-07-25 | Kirim laporan harian & mingguan ke grup WA (Excel, tombol manual) |
| 099 | 2026-07-25 | Integrasi WhatsApp (WAHA): grup per paket + kirim kegiatan 1 klik |
| 098 | 2026-07-25 | Kegiatan lapangan: Edit + Kendala/Solusi; input foto bisa dari galeri |
| 097 | 2026-07-25 | Import RAB: JALUR PREVIEW (flatten) juga harus benar — #REF! jadi item sendiri |
| 096 | 2026-07-25 | Import RAB: item berharga yang punya baris-tambahan tak boleh hilang nilainya |
| 095 | 2026-07-25 | Import RAB: harga = NEGOSIASI (bug ambil HPS pada header 2-baris) |
| 094 | 2026-07-25 | Semua dropdown form → Combobox SEARCHABLE (bukan AG Grid) |
| 093 | 2026-07-25 | Istilah peran "Mandor" → "Pelaksana" (label saja) |
| 092 | 2026-07-25 | Cetak Jadwal tetap tersedia sebelum SPMK (asumsi mulai hari ini) |
| 091 | 2026-07-25 | Kepatuhan: UNGGAH dokumen inline di tiap item (status ikut dokumen) |
| 090 | 2026-07-25 | KETERANGAN = batang skala 0–100% checkerboard hitam-putih |
| 089 | 2026-07-25 | Kurva-S Excel: SCATTER mulai dari origin 0% (bukan line/kategori) |
| 088 | 2026-07-25 | Kurva-S: skala 0–100% (KET) + titik marker tak kepotong |
| 087 | 2026-07-25 | Kurva-S = OVERLAY transparan DI ATAS tabel (bukan chart terpisah di bawah) |
| 086 | 2026-07-25 | Kurva-S di Excel = GRAFIK NATIVE (bukan gambar) + Unduh Excel Jadwal |
| 085 | 2026-07-25 | Import RAB: perampingan xlsx (anti-OOM) sebelum parse exceljs |
| 084 | 2026-07-25 | Import RAB: abaikan baris yang DI-HIDE di Excel |
| 083 | 2026-07-25 | Cetak Jadwal (Time Schedule) + kurva-S di export Excel |
| 082 | 2026-07-25 | Jadwal BERBASIS ITEM (cost-loaded) = sumber tunggal baseline + KKP + saran |
| 081 | 2026-07-24 | Distribusi bobot per pekerjaan = LONCENG, bukan rata per minggu |
| 080 | 2026-07-24 | Validasi kalibrasi kurva-S ke sumber kredibel + re-test |
| 079 | 2026-07-24 | Baseline = jadwal presedensi per-KATEGORI (sumber tunggal) — cocok jadwal sipil |
| 078 | 2026-07-24 | Milestone administrasi: scope induk vs lokasi + sync dari dokumen |
| 077 | 2026-07-24 | Kurva-S = cost-loaded schedule × envelope ramp (menyempurnakan 076) |
| 076 | 2026-07-24 | Kurva-S baseline = S sejati (Beta-PERT), bukan diagonal |
| 075 | 2026-07-24 | Pembulatan RAB ke rupiah via apportionment (cocok Excel) |
| 074 | 2026-07-24 | Unggah dokumen langsung dari dalam paket (hapus round-trip) |
| 073 | 2026-07-24 | Alur normal: pilih vendor & lokasi dari master impor (bukan hanya manual) |
| 072 | 2026-07-24 | Rekonsiliasi nilai kontrak (input) vs Σ RAB semua lokasi (halaman paket) |
| 071 | 2026-07-24 | Header laporan: nama resmi + nilai per-lokasi; editor kurva-S collapsible |
| 070 | 2026-07-24 | Penjadwalan konstruksi per-unit menggantikan trade-global (kurva + rekomendasi) |
| 069 | 2026-07-23 | Editor jadwal per pekerjaan (kurva-S standar sipil) + pulihkan/banding riwayat baseline |
| 068 | 2026-07-23 | Hitung ulang kurva-S: idempotent + konfirmasi (bukan spam versi) |
| 067 | 2026-07-23 | Lampiran dokumen kegiatan lapangan (ringkas, di luar Document Center) |
| 066 | 2026-07-23 | Transisi stage paket: konfirmasi wajib, guard serah terima 100%, mundur (koreksi) |
| 065 | 2026-07-23 | Hapus foto kegiatan lapangan + buka kembali (final→draft) |
| 064 | 2026-07-23 | Ganti judul kategori RAB (perbaiki kategori tanpa judul) |
| 063 | 2026-07-23 | Nama paket vs judul kontrak (workTitle) + koreksi kontrak super-admin |
| 062 | 2026-07-23 | Manajemen & gabung master perusahaan (vendor) |
| 061 | 2026-07-23 | Impor batch katalog lokasi (xlsx) — jalur produksi & lanjutan |
| 060 | 2026-07-23 | Master lokasi awal (impor xlsx) + jalur cepat admin (bypass) buat proyek |
| 059 | 2026-07-23 | Patch keamanan: next 16.2.10→16.2.11 + override sharp/fast-uri |
| 058 | 2026-07-23 | Kegiatan & Dokumentasi Lapangan (non-pekerjaan) — entitas terpisah |
| 057 | 2026-07-18 | Algoritma penjadwalan kurva-S per-lokasi (cost-based duration + presedensi CPM) |
| 056 | 2026-07-17 | Pembuatan user berjenjang + flag pembuat (createdById) |
| 055 | 2026-07-17 | Nilai RAB = HARGA NEGOSIASI (bukan HPS) via deteksi header |
| 054 | 2026-07-17 | Kontrak simpan masa pelaksanaan (hari); tanggal mulai dari SPMK; lokasi + kecamatan |
| 053 | 2026-07-16 | Penanda tangan dokumen KKP di kontrak + realisasi kurva-S per periode |
| 052 | 2026-07-15 | Kurva-S evaluasi kontinu (mulai 0, bentuk-S) + saran rencana mingguan otomatis |
| 051 | 2026-07-14 | REBUILD TOTAL — arsitektur, schema, stack (menggantikan banyak keputusan lama) |
| 050 | 2026-07-13 | Kunci anti-input-ganda per item laporan |
| 049 | 2026-07-13 | RAB pre-PPN + warning nilai kontrak ≠ RAB |
| 048 | 2026-07-13 | Tahap pengadaan OTOMATIS dari dokumen (bukan manual) |
| 047 | 2026-07-13 | Peta di-optimalkan (ala area-manager Cloudflare) |
| 046 | 2026-07-13 | Prospek jadi workspace administrasi SEJAK tender |
| 045 | 2026-07-13 | Laporan Mingguan & Bulanan (generate on-the-fly, format KKP) |
| 044 | 2026-07-13 | Catatan deviasi & pemulihan jadi LOG (riwayat), bukan 1 field |
| 043 | 2026-07-13 | Lokasi jadi workspace ber-tab (IA) + harian input-first |
| 042 | 2026-07-13 | Cetak halaman bersih (tanpa shell) + rapikan menu |
| 041 | 2026-07-13 | Halaman detail Paket + timeline adendum |
| UI | 2026-07-13 | Sidebar desktop sticky (fixed saat scroll) |
| 040 | 2026-07-13 | Pengadaan = alur proyek: entitas Prospek → Kontrak |
| 039 | 2026-07-13 | Foto: thumbnail + lightbox + EXIF; Reset penuh "mulai dari nol" |
| 038 | 2026-07-13 | Laporan Harian format KKP — "mandor simpel, SM lengkapi" |
| 037 | 2026-07-13 | Akomodasi format resmi KKP/DJPT (paket dokumen kementerian) |
| 036 | 2026-07-13 | Modul Keuangan — input manual per lokasi + derivasi |
| 035 | 2026-07-12 | Design system enterprise + shell sidebar (Command Center) |
| 034 | 2026-07-12 | Halaman Laporan: detail approval + section "Sudah disetujui" + admin lihat semua |
| 033 | 2026-07-12 | Lapor harian: satuan jelas + blokir volume > rencana + visibilitas laporan/foto |
| 032 | 2026-07-12 | Data grid open-source (TanStack Table) ganti tabel kaku |
| 031 | 2026-07-12 | Lapor Harian mobile-first (redesign untuk mandor) |
| 030 | 2026-07-12 | Pengadaan = status per lokasi + tampilan eksekutif; Area Manager = scoped |
| 029 | 2026-07-12 | Peta lokasi (Leaflet) — klik titik → progress + fase + foto |
| 028 | 2026-07-12 | Pembobotan PER ITEM + jadwal dependensi + saran mingguan |
| 027 | 2026-07-12 | Kurva-S rencana ber-versi: auto-generate + editable, regenerate saat adendum |
| 026 | 2026-07-12 | Beranda = overview (Dashboard digabung), grandTotal dari kategori aktif |
| 025 | 2026-07-11 | Foto bukti menempel ke item laporan (draft), tampil ke approver |
| 024 | 2026-07-11 | Arsip dokumen mengikuti siklus PBJ + storage R2 |
| 023 | 2026-07-11 | RAB revisioning = snapshot per revisi (Model A) |
| 022 | 2026-07-10 | RabItem parent-child onDelete Cascade |
| 021 | 2026-07-10 | Session JWT + per-role expiry (resolve OPEN_ISSUES) |
| 020 | 2026-07-10 | Drop extension postgis |
| 019 | 2026-07-10 | Auth = username/email + password (OVERRIDE 003 & PROJECT §8) |
| 018 | 2026-07-10 | Mandor jadi role login + multi-lokasi (OVERRIDE 007 & 013) |
| 017 | 2026-07-10 | Contractor tabel terpisah (OVERRIDE OPEN_ISSUES) |
| 016 | 2026-07-10 | Contract 1:N Location (OVERRIDE 011) |
| 015 | 2026-07-10 | PROJECT.md + CLAUDE.md + docs/ sebagai kontrak |
| 014 | 2026-07-10 | Grand total = SUM kategori aktif (bukan Resume sheet) |
| 013 | 2026-07-10 | Voice-note DROPPED |
| 012 | 2026-07-10 | Session duration per role |
| 011 | 2026-07-10 | Contract 1:1 dengan Location (tentatif) |
| 010 | 2026-07-10 | Rollout 83 lokasi day 1, bukan pilot |
| 009 | 2026-07-10 | Kurva-S auto-generated dari RAB |
| 008 | 2026-07-10 | Weekly Plan advisory, tidak locking |
| 007 | 2026-07-10 | Site Manager sebagai single accountability |
| 006 | 2026-07-09 | Data model append-only |
| 005 | 2026-07-09 | Progress reporting = volume, bukan slider % |
| 004 | 2026-07-09 | Photo storage |
| 003 | 2026-07-09 | Auth strategy |
| 002 | 2026-07-09 | Database + ORM |
| 001 | 2026-07-09 | Stack utama |
