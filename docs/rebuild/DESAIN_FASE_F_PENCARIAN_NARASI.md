# Desain Fase F — pencarian narasi lapangan (yang di brief disebut "RAG")

**Status: USULAN. Belum ada satu baris kode pun.**
Dibuat 2026-08-19 atas permintaan user ("rancang dulu, jangan bangun").

`DECISIONS 369` mencatat: *"Fase RAG tidak boleh dimulai tanpa persetujuan
eksplisit user dan bukan keputusan MARLIN saat ini."* Dokumen ini tidak
mencabut catatan itu — ia menyiapkan bahan supaya keputusannya bisa diambil.

---

## 1. Masalah yang sebenarnya

Sesudah Fase A–E, MARLIN bisa menjawab pertanyaan dari fakta **terstruktur**:
progress, deviasi, kelengkapan laporan, kendala, kontrak, RAB, milestone.
Semuanya angka yang lahir dari calculation layer.

Yang masih tidak bisa dijawab sama sekali:

> *"kenapa Kedung Mutih tertinggal?"*
> *"masalah material di Demak bulan ini apa saja?"*
> *"pernah ada masalah izin di lokasi mana?"*

Jawabannya ADA — di catatan laporan harian, catatan kegiatan lapangan, dan
uraian kendala. Semuanya teks bebas yang hari ini **tidak pernah bisa dicari**.
`buildNarrativeBundle` memang mengirim sebagian teks itu ke AI, tapi hanya untuk
lokasi & periode yang sudah dipilih lebih dulu — bukan sebagai pencarian.

Jadi kebutuhannya lebih tepat disebut **pencarian narasi**, bukan "RAG". RAG
adalah salah satu cara memenuhinya, dan bagian 4 menjelaskan kenapa itu belum
tentu cara yang pertama.

---

## 2. Yang TIDAK boleh berubah

Empat aturan yang sudah berlaku dan harus tetap berlaku sesudah Fase F:

1. **AI bukan sumber angka** (PROJECT.md). Semua angka dari calc layer.
2. **Klaim terikat lima hal** — lokasi + metrik + nilai + periode + sumber; bagian
   yang menyebut angka tanpa klaim sah DIBUANG (`DECISIONS 378`).
3. **Pagar kapabilitas** — yang tidak berhak tidak menerima datanya sama sekali,
   bukan menerima lalu diminta diam (`DECISIONS 379`).
4. **Lingkup lokasi** — jawaban tidak pernah menyentuh lokasi di luar hak penanya.

---

## 3. Konflik intinya: catatan lapangan PENUH angka

Ini bagian terpenting dokumen ini, dan yang paling mudah dilewatkan.

`DECISIONS 378` membuang setiap bagian jawaban yang menyebut angka tanpa klaim
tervalidasi. Sementara itu catatan lapangan berbunyi seperti:

> *"cor lantai 12 m3, tenaga 8 orang, hujan mulai jam 14 jadi berhenti"*

Kalau potongan itu ditarik apa adanya lalu dirangkum model, hasilnya memuat
angka yang **tidak pernah lewat calculation layer**. Dua akibat yang dua-duanya
buruk:

- validator membuang hampir semua jawaban → fitur terasa rusak; atau
- orang tergoda **melonggarkan** `DECISIONS 378` supaya jawabannya keluar — dan
  di situlah "AI bukan sumber angka" berhenti berlaku, diam-diam.

### Usulan: pisahkan tegas dua jenis pernyataan

| | asal | boleh memuat angka? |
|---|---|---|
| **Angka resmi** | calculation layer, klaim terikat 378 | ya, tervalidasi |
| **Kutipan lapangan** | potongan teks, **verbatim** | ya, tapi hanya di dalam tanda kutip |

Aturannya:

- Kutipan harus **verbatim** — validator memeriksa teksnya benar-benar
  *substring* dari potongan aslinya. Parafrase ditolak. Ini pagar anti-karangan
  yang bisa diuji, bukan imbauan di prompt.
- Kutipan membawa jenis klaim kedua, mis. `kutipan`, terikat ke `chunkId` +
  `sourceRefId` — jadi pembaca bisa membukanya.
- Balasan **memisahkan keduanya secara visual**: angka MARLIN vs *"kata pelapor
  pada laporan 12 Agustus"*. Angka di dalam kutipan tidak pernah tampil sebagai
  angka MARLIN.
- Parafrase yang memuat angka tetap DIBUANG seperti sekarang. Model tidak boleh
  "merangkum" angka dari teks.

Tanpa aturan ini, Fase F akan pelan-pelan membatalkan Fase D4.

---

## 4. Penyimpanan & pencarian — tiga pilihan

### Temuan yang mengubah rekomendasi

Diperiksa langsung pada PostgreSQL 16.13 yang dipakai:

```
pg_available_extensions → pg_trgm ADA;  vector (pgvector) TIDAK ADA
pg_ts_config            → ada konfigurasi 'indonesian' bawaan
```

Artinya Postgres sudah bisa melakukan **pencarian teks penuh berbahasa
Indonesia** (dengan stemming) hari ini juga, tanpa ekstensi apa pun.

| | Pilihan A — FTS Postgres | Pilihan B — pgvector | Pilihan C — cosine di SQL |
|---|---|---|---|
| Ketersediaan | **sudah ada** (`indonesian` + `pg_trgm`) | **tidak ada** di PG ini; harus diverifikasi di Railway | ada (kolom `float4[]`) |
| Dependensi baru | tidak ada | ekstensi + stack "pinned exact" berubah | tidak ada |
| Teks keluar ke pihak ketiga | **tidak** | ya (embedding) | ya (embedding) |
| Ongkos per pertanyaan | nol | embedding query | embedding query |
| Tahan salah ketik | ya (`pg_trgm`) | ya | ya |
| Paham makna ("macet" ≈ "tertunda") | tidak | ya | ya |
| Skala 100k potongan | baik (GIN) | baik (HNSW) | buruk (tanpa indeks ANN) |

**Pilihan C tidak disarankan** — tanpa indeks perkiraan, tiap pertanyaan
memindai seluruh tabel.

### Rekomendasi: mulai dari A, ukur, baru pertimbangkan B

Untuk pertanyaan yang benar-benar diajukan orang lapangan — nama material, nama
pekerjaan, "hujan", "izin", "alat rusak" — pencarian kata kunci berstemming
Indonesia kemungkinan besar sudah menjawab sebagian besar. Ia juga:

- tidak mengirim satu huruf pun ke luar sistem;
- tidak menambah biaya per pertanyaan;
- tetap hidup saat penyedia AI mati (sejalan `DECISIONS 375`);
- bisa dipasang dan diukur cepat, sehingga keputusan soal embedding diambil
  dengan **bukti**, bukan dugaan.

Embedding baru layak ditambahkan kalau pengukuran menunjukkan A gagal pada
pertanyaan nyata — bukan karena "RAG" terdengar lebih maju.

---

## 5. Apa yang di-index

| Sumber | Kolom | Catatan |
|---|---|---|
| Laporan harian | `DailyReport.notes` | **hanya status final/disetujui** — lihat di bawah |
| Item laporan | `DailyReportItem.notes` | dikaitkan ke nama item RAB |
| Kegiatan lapangan | `FieldActivity.notes` | |
| Kendala | `Issue.title`, `Issue.description` | |
| Recovery | `RecoveryAction.notes` | |

**Dokumen (PDF di R2) TIDAK masuk tahap ini.** Ekstraksi teks PDF + OCR untuk
hasil pindaian adalah proyek tersendiri dengan kegagalannya sendiri; menyelipkannya
di sini membuat Fase F tidak pernah selesai.

Metadata WAJIB per potongan: `locationId`, tanggal kerja, jenis sumber, id baris
asal, dan status laporannya.

### Laporan draft & perlu-koreksi TIDAK di-index

Menjawab dari laporan yang belum disetujui berarti menyebarkan angka dan
keterangan yang justru sedang diperbaiki. Ini sejalan dengan `COUNTED_REPORT_STATUSES`
yang sudah dipakai calculation layer.

---

## 6. Kesegaran: koreksi harus benar-benar mencabut

Laporan harian punya alur `draft → dikirim → perlu_koreksi → disetujui → final`.
Artinya teks bisa **berubah** dan bisa **turun status**.

Index yang tidak mengikuti perubahan itu akan menjawab dari versi yang sudah
dicabut — dan itu jenis kesalahan yang paling sulit terlihat, karena jawabannya
tampak normal dan bersitasi.

Syarat: potongan diperbarui saat `updatedAt` berubah, dan **dihapus** saat
laporan keluar dari status yang boleh di-index. Ini berlaku untuk pilihan A
maupun B.

---

## 7. Lingkup & kapabilitas — disaring SEBELUM peringkat

Penyaringan lokasi harus terjadi **di dalam query**, bukan sesudah hasil
diperingkat. Menyaring sesudahnya membocorkan keberadaan lokasi lain lewat
jumlah hasil dan skornya — kebocoran yang tidak menampilkan satu huruf pun teks
asing, tapi tetap kebocoran.

Pagar kapabilitas `DECISIONS 379` tetap berlaku: catatan yang menyinggung
keuangan tidak boleh muncul untuk peran tanpa `finance.view`. Karena teks bebas
tidak bisa dipagari per-metrik seperti fakta terstruktur, **usulan konservatif**:
untuk tahap pertama, hanya index sumber lapangan (laporan/kegiatan/kendala) dan
JANGAN index catatan bermuatan keuangan sama sekali.

---

## 8. Perkiraan ukuran & ongkos

83 lokasi × ~1 laporan/hari ≈ **30.000 laporan/tahun**, ditambah item dan
kegiatan → kasar **±100.000 potongan** untuk satu tahun program.

- Pilihan A: nol biaya berulang; satu kolom `tsvector` + indeks GIN.
- Pilihan B: satu kali embedding untuk seluruh korpus + re-embed tiap perubahan
  + satu embedding per pertanyaan. Perlu masuk hitungan guard AI Hub yang sudah
  ada (kill switch, batas laju, estimasi biaya per run).

---

## 9. Rencana bertahap

| Tahap | Isi | Bisa dinilai dari |
|---|---|---|
| **F1** | Index FTS `indonesian` + `pg_trgm` atas sumber lapangan, disaring lingkup, potongan bersitasi | pertanyaan nyata: berapa yang terjawab benar |
| **F2** | Kutipan terikat + pagar verbatim (bagian 3), pemisahan visual angka resmi vs kutipan | uji gigi: parafrase berangka harus DIBUANG |
| **F3** | *Hanya bila F1 terbukti kurang* — embedding + pgvector, dengan keputusan pengungkapan tertulis | perbandingan langsung terhadap F1 |

F1 dan F2 tidak mengirim data ke mana pun dan tidak menambah dependensi.

---

## 10. Yang perlu Anda putuskan

1. **Boleh atau tidak teks catatan lapangan keluar ke penyedia embedding?**
   Ini keputusan pengungkapan, sejenis "uang lewat WhatsApp" yang Anda tunda —
   bukan keputusan teknis. Kalau jawabannya tidak, F3 gugur dan F1+F2 saja.
2. **Mulai dari F1 (pencarian kata) atau langsung F3 (embedding)?**
   Saya menyarankan F1 lebih dulu, dengan alasan di bagian 4.
3. **Dokumen PDF ikut?** Saran: tidak untuk sekarang (butuh OCR).
4. **Laporan draft ikut di-index?** Saran: tidak — hanya yang sudah disetujui.

Sebelum keempatnya terjawab, tidak ada kode yang ditulis.
