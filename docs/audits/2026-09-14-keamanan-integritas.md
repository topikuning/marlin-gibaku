# Audit keamanan dan integritas MARLIN · 14 September 2026

Branch: `codex/audit-integritas-keamanan-20260913`, dari `dev` commit
`050a49b450aedf43b60f032e2f80c787707c3882`, kemudian diselaraskan dengan
`76aabebae0a8665ede245b774d08412baabb69ff`. Tujuan PR: `dev`.

Audit ini memeriksa kode, dependensi, dan perilaku aplikasi pada database uji
terisolasi. Tidak memakai database, bucket, kredensial, atau pengiriman pesan
produksi. Temuan di bawah adalah cacat yang berhasil direproduksi; bukan klaim
bahwa seluruh sistem sudah bebas kerentanan.

## Temuan dan perbaikan

| ID | Prioritas | Temuan / akibat sebelum perbaikan | Perbaikan | Bukti regresi |
|---|---|---|---|---|
| A01 | P1 | Sesi yang wajib mengganti password masih dapat membaca API privat langsung. | 19 endpoint menolak dengan HTTP 403 sebelum akses data. | `tests/unit/api-wajib-ganti-password.test.ts`, memanggil GET nyata. |
| A02 | P1 | Admin lintas lokasi dapat mengakses artefak AI organisasi lain lewat ID. | Pemeriksaan organisasi pada pembuat, paket, dan run; berlaku pada edit/transisi/distribusi, Excel, cetak, detail run, dan riwayat. | `tests/integration/audit-akses-artefak.test.ts`, dua organisasi dan aksi/route nyata. |
| A03 | P1 | Dua penerapan saran yang bertumpuk membuat dua kendala. | Klaim status draft atomik di transaksi yang sama dengan pembuatan kendala. | Tes menahan permintaan pertama setelah membaca draft sampai permintaan kedua commit; hanya satu kendala terbentuk. |
| A04 | P1 | Edit tertunda menimpa laporan AI atau paparan setelah dibekukan permintaan lain. | Pembaruan bersyarat pada status, `updatedAt`, dan `frozenAt: null`; audit satu transaksi. | Dua tes balapan dengan gerbang eksplisit, memeriksa isi snapshot setelah freeze. |
| A05 | P2 | Transisi biasa dapat memberi status terkirim tanpa menjalankan distribusi. | Status terkirim ditolak pada aksi transisi laporan, diarahkan ke aksi distribusi. | Tes status tetap beku dan respons meminta distribusi. |
| A06 | P1 | Dokumen paket yang tidak ditugaskan dapat dibaca/diubah melalui ID walau tidak muncul di daftar. | Cakupan paket/lokasi dipakai pada unduh, halaman detail, edit metadata, pembatalan, pemulihan, dan penggantian versi. | Tes unduh 403 dan metadata tidak berubah pada paket lain dalam organisasi sama. |
| A07 | P1 | Relasi kontrak/adendum/milestone dapat melewati batas paket; unggahan dapat menyelesaikan milestone paket lain. | Turunkan paket dari relasi, tolak konflik paket/lokasi/kontrak, lalu periksa penugasan sebelum unggah. | Enam kasus negatif relasi; satu unggahan kontrak sendiri berhasil dan menyimpan paket turunan. |
| A08 | P1 | Penghapusan arsip asli dan konversi HEIC massal menjangkau organisasi lain. | Filter organisasi selalu diterapkan, ditambah cakupan lokasi; jumlah arsip pada halaman ikut dibatasi. | `tests/integration/perbaikan-cap.test.ts`, foto organisasi kedua tidak dihapus/diubah. |
| A09 | P1 | Restamp/rotasi/konversi menghapus berkas yang masih dirujuk snapshot laporan/paparan. | Pertahankan versi lama saat penggantian dan pelengkapan cap; pembersihan lewat audit R2 yang sudah ada. | Tiga jalur laporan final, paparan beku memakai foto kegiatan, dan retensi sebelum snapshot commit. |
| A10 | P2 | Titik realisasi kurva-S bergeser satu indeks dan dapat menghasilkan `cy=NaN`. | Titik memakai seri berjangkar yang sama dengan garis. | `tests/unit/scurve-titik.test.tsx`, koordinat SVG dari render aktual serta ekor data kosong. |
| A11 | P2 | Dependensi terkunci terkena advisory keamanan. | Perbarui PostCSS, MySQL2, Hono, node-server, Valibot, UUID, js-yaml, dan Vitest; pin HEIC eksak. | Audit dependensi, generate Prisma, migrasi DB uji, suite aplikasi, build. |
| A12 | P1 | Sesi PostgreSQL non-UTC menggeser timestamp melalui adapter Prisma; retry 30 detik langsung dihabiskan sampai gagal permanen. | Pin UTC pada opsi setiap koneksi, pertahankan opsi URL lainnya; format pengguna tetap WIB. | `tests/integration/database-waktu.test.ts` memaksa Asia/Jakarta, memeriksa epoch absolut; suite antrean nyata kembali lulus. |

A02 tidak menghapus cakupan lokasi: organisasi dan lokasi sama-sama wajib lolos.
Run lama dengan `orgId` kosong memakai organisasi pembuat; run grup yang tidak
memiliki pembuat memakai `orgId` nyata. Artefak tetap memerlukan pembuat dari
organisasi pengguna serta paket/run yang tidak bertentangan.

A09 sengaja menahan semua versi gambar lama, termasuk saat snapshot belum
tersimpan. Memeriksa JSON hanya pada saat penggantian tidak cukup untuk balapan
tersebut. Daftar aktif memakai key baru; snapshot beku tetap memakai key lama.
Audit R2 memeriksa umur minimum tujuh hari dan rujukan JSON sebelum pembersihan.
Konsekuensinya penyimpanan bertambah sampai pembersihan dijalankan. Patch ini
tidak menjalankan pembersihan dan tidak merekonstruksi berkas yang sudah hilang.

## Bukti pengujian

- Baseline unit sebelum patch: 277 berkas, 3.119 tes lulus.
- Pembuktian balik: semua perubahan sumber dilepas sementara ke commit dasar,
  tanpa menghapus tes regresi. Hasil: **45 gagal, 17 lulus** pada empat berkas
  (62 tes). Sumber dipulihkan otomatis melalui blok `finally`.
- Bukti balik tambahan A12: dua tes timestamp gagal sebelum patch, lulus
  setelah pin UTC, lalu gagal kembali ketika pin dilepas. Kelima belas tes
  antrean WhatsApp juga lulus setelah koneksi diperbaiki.
- Tes balapan menggunakan penahanan eksplisit sesudah pembacaan, bukan hanya
  `Promise.all`. Ini memaksa urutan yang menyebabkan korupsi sebelum patch.
- Database: PostgreSQL 18 lokal khusus `marlin_test`, migrasi repository diterapkan.
  Session pengguna dan R2 dimock untuk mengisolasi otorisasi serta keberadaan
  obyek; aksi aplikasi, transaksi, dan constraint PostgreSQL benar-benar berjalan.
- Server database lokal memakai Asia/Jakarta; koneksi aplikasi kini memaksa
  UTC. Diagnostic menunjukkan `now()` dibaca adapter tujuh jam lebih maju dari
  epoch PostgreSQL sebelum patch. PostgreSQL default UTC dapat menyembunyikan
  cacat ini; tes menyertakan opsi non-UTC agar tidak bergantung pada default CI.
- Runtime lokal: Node 24.19.0, pnpm 11.17.0. CI menggunakan versi `.nvmrc`.
- Typecheck dan lint lulus. Satu tes struktur HEIC lama diperbarui karena mengunci
  bentuk percabangan penghapusan, sementara retensi kini diverifikasi pada aksi.
- Hasil lokal: 3.143 unit (279 berkas), 1.139 integrasi (108 berkas),
  typecheck, lint, dan build produksi lulus. Status CI dicatat pada PR.
  E2E hanya dijalankan CI sesuai aturan repository.

### Integritas angka

Berkas rujukan: `PROJECT.md`, protokol integritas perhitungan, test plan,
`progress.ts`, dan konsumen `scurve-chart.tsx`.

| Aspek | Sebelum / sesudah |
|---|---|
| Sumber nilai | Prop `actualPct` dari perhitungan kanonik, tetap sama. |
| Seri gambar | Garis memakai `[0, ...actualPct]`; titik sekarang memakai seri itu juga. |
| Contoh | Dua minggu 25%/75% menghasilkan titik SVG `(40,252)`, `(334,192)`, `(628,72)`. |
| Data kosong | Tidak menambahkan titik nol untuk minggu yang belum memiliki realisasi. |
| Rumus / status / tanggal / pembulatan / revisi | Tidak berubah. Lima berkas formula kanonik tidak diedit. |

## Dependensi

Audit seluruh pohon dependensi pada 14 September 2026 mengembalikan nol advisory
yang tidak dikecualikan, termasuk dev dependencies. Pengecualian lama
`GHSA-mh99-v99m-4gvg` tetap ada; tidak menambah pengecualian. Tiga lini
brace-expansion terpasang masing-masing 1.1.18, 2.1.4, dan 5.0.9.

Rujukan advisory patch:

- [PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp),
  [MySQL2](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3).
- [Hono](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv),
  [Hono node-server](https://github.com/advisories/GHSA-frvp-7c67-39w9).
- [Valibot](https://github.com/advisories/GHSA-5qjj-4xww-7phc),
  [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- [js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh),
  [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Batas dan pekerjaan tersisa

- Pemulihan snapshot produksi yang obyeknya sudah terhapus memerlukan
  inventarisasi bucket/cadangan. Kunci yang berbeda dari `photos.r2Key` bukan
  bukti obyek hilang. Tidak mengubah snapshot historis untuk menyembunyikan masalah.
- Isu data RAB historis/seed di `OPEN_ISSUES.md` memerlukan sumber HPS asli serta
  rekonsiliasi terhadap progress yang sudah berjalan; tidak diperbaiki dengan
  UPDATE massal atau perubahan rumus.
- RLS database, rate limit selain login, CSP/security headers, dan uji penerimaan
  manusia masih pekerjaan terbuka. Audit ini tidak menerapkan pembatasan baru
  menyeluruh yang belum memiliki skenario kompatibilitas.
- Jika database historis pernah dipakai dengan sesi non-UTC, timestamp lama
  perlu direkonsiliasi terhadap sumbernya; patch tidak menggeser data historis.
- Konfigurasi Railway/R2/WAHA, rahasia produksi, pemulihan cadangan, dan paparan
  jaringan belum diverifikasi. Tidak ada penetration test pada layanan hidup.
- Perubahan harus ditinjau independen sebelum merge; nomor keputusan `(baru)`
  diberikan pemeriksa terakhir. Tidak merge atau deploy dari audit ini.
