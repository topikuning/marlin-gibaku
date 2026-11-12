# OPEN_ISSUES.md

Bug + technical debt + missing pieces yang MASIH TERBUKA. Yang sudah selesai
dihapus dari sini — riwayatnya ada di `DECISIONS.md` dan git history.

Priority: 🔴 Critical (blocking production) · 🟡 Important · 🟢 Nice-to-have ·
🔵 Future · **KEPUTUSAN** = menunggu jawaban user, bukan pekerjaan teknis.

Ditulis ulang saat rebuild total 2026-07-14
(isu lama pra-rebuild ada di git history — mayoritas selesai by design di rebuild:
audit log kini ditulis tiap mutasi, rate limit login ada, session revocable,
anti-double-input jadi constraint DB, keuangan transaksional, zod di boundary baru).

---

## Data

- 🟡 **DATA-JUMLAH-NOL — item ber-`amount` 0 padahal volume dan harga satuannya
  terisi.** Terukur pada RAB aktif 16 lokasi: 3–19 baris per lokasi, dan di
  `purworejo` nilainya **Rp 22,95 juta** (19 baris). Sebabnya JUMLAH di berkas sumber
  tertulis **0** (bukan kosong) dan dipakai apa adanya. Sel JUMLAH yang KOSONG sudah
  punya aturan sejak DECISIONS 586 (subtotal berkas yang memutuskan, barisnya disebut
  di pratinjau), tetapi yang bernilai 0 lolos dari aturan itu (`barisTanpaJumlah` di
  `flatten.ts` hanya menjaring `null`) dan tidak disebut saat impor. Akibatnya
  pekerjaannya tercatat tanpa nilai: bobot item, kurva-S, dan seluruh persentase
  progress menghitungnya nol. Sejak DECISIONS 601 unduhan RAB MENYEBUTKAN baris ini
  di catatan sheet Resume, jadi tidak lagi tak terlihat — tetapi datanya sendiri
  belum dibetulkan. FIX: putuskan (tanya user) apakah baris ber-JUMLAH 0 diisi
  `volume × harga satuan` saat impor, atau ditolak dengan menyebut barisnya.

- 🔴 **Kualitas data seed JSON (parser python lama)**: `total_value` kategori korup di
  seed-data/*.json — roman ganda berbagi nilai (IX/IX#2), kategori XI–XIII hilang
  (item tergabung ke kategori sebelumnya), beberapa kategori 0. Rebuild memakai basis
  konsisten Σ leaf (`flattenParsedRab`), tapi pembagian kategori tetap mengikuti JSON
  korup. FIX SEBENARNYA: minta file HPS xlsx asli → re-import via UI import RAB
  (parser TS baru), atau perbaiki `scripts/parse_hps.py` + regenerate.
- 🔴 **DATA-03 — RAB yang terlanjur diimpor sebelum DECISIONS 252 masih membawa angka
  yang KELEBIHAN.** Parser sudah diperbaiki, tapi perbaikan hanya berlaku untuk impor
  BARU; baris subtotal yang terlanjur tersimpan sebagai node pekerjaan tidak hilang
  sendiri. Terukur pada korpus: 8 berkas RAB KNMP **NTB** kelebihan 8–18% (mis. KUTA
  3,38 M → 2,86 M; MERTAK 3,37 M → 2,70 M). Nilai kontrak, bobot item, kurva-S
  baseline, dan seluruh persentase progress ikut melenceng karena semuanya diturunkan
  dari `grandTotal`.

  Jalankan di DB produksi untuk mendaftar yang terdampak — polanya SEMPIT dengan
  sengaja (kata kunci langsung disambung huruf), karena rekap ber-spasi tidak pernah
  masuk DB dan melonggarkan polanya justru menjaring "Total Station":

  ```sql
  SELECT l.name AS lokasi, rr.revision_no, rr.status,
         count(*) AS baris_rekap, sum(n.amount) AS nilai_berlebih,
         string_agg(DISTINCT n.name, ' | ') AS contoh
  FROM rab_nodes n
  JOIN rab_revisions rr ON rr.id = n.revision_id
  JOIN locations     l  ON l.id  = rr.location_id
  WHERE n.name ~* '^(jumlah|subtotal|total|grand *total)[a-z]'
  GROUP BY 1,2,3 ORDER BY nilai_berlebih DESC;

  -- kategori yang judulnya hilang gara-gara kode romawi bertitik ("IV.", "VII.")
  SELECT l.name, rr.revision_no, n.code, n.name
  FROM rab_nodes n
  JOIN rab_revisions rr ON rr.id = n.revision_id
  JOIN locations     l  ON l.id  = rr.location_id
  WHERE n.name LIKE '%judul tidak ada di file%';
  ```

  Perbaikannya **impor ulang berkas HPS/negosiasi aslinya** lewat UI impor RAB —
  bukan `UPDATE` manual. Menghapus node rekapnya saja tidak cukup: `lineageKey`,
  `sortOrder`, dan `total_value` revisi harus konsisten, dan itu tugas jalur impor.
  Lokasi yang laporan hariannya sudah berjalan perlu diperiksa lebih dulu — impor
  ulang membuat revisi baru, dan item laporan menempel pada lineage revisi lama.
  **Butuh keputusan user** untuk lokasi yang sudah punya progress tercatat.
  (DB dev bersih — 0 baris; ini khusus produksi.)
- 🟡 **CategoryPhase/TRADES hardcoded** di `src/lib/scurve/generate.ts` (keyword→window).
  Kandidat: tabel konfigurasi effective-dated.
- 🟢 Province/Regency masih string bebas (belum reference table BPS).

- 🟡 **KAWAL-RELATIF — jalur Relatif (Wakil Sah / Penyuluh) Kawal KNMP belum
  ditampilkan.** Data sungguhan (DECISIONS 693) membuktikan makna angka lain, tetapi
  tidak Relatif. Calon terkuat: `realisasi_pengawas` / `realisasi_pelaksana` (tidak
  sama dengan angka lain mana pun). FIX: Program Director mencocokkan "Angka A/B" di
  tab Kawal KNMP satu lokasi dengan angka Relatif di layar Kawal, ATAU uji sambungan
  berikutnya menunjukkan Relatif = rasio terhadap rencana → tetapkan field-nya →
  tampilkan di tab dan strip atas.
- 🟢 **KAWAL-SARANA — makna progres per sarana Kawal belum terbukti.** Tabel per
  sarana (DECISIONS 694) menampilkan angka sarana Kawal apa adanya dan selisihnya
  tanpa warna, karena Σ bobot × progres sarana belum terbukti sama dengan
  `progres_final`. FIX: uji sambungan berikutnya (sudah menghitung Σ bobot × progres
  ÷ 100 dan ÷ Σ bobot) menunjukkan hubungannya → tetapkan maknanya → beri tingkat.

## Security

- 🟡 **RLS belum diimplementasi** (dan TIDAK diklaim). Otorisasi di application layer
  (capability + scope), diuji test. RLS = hardening tahap berikut.
- 🟡 Rate limit baru ada untuk login dan panggilan AI (`ai-hub/guard.ts`, per user/jam &
  org/hari); server action lain belum dibatasi.
- 🟢 CSP/security headers belum diset di next.config.

## Fitur ditunda sadar (lihat docs/rebuild/REBUILD_PLAN.md)

- 🟡 **Offline di luar `/foto-cepat`** — sekarang: draft lokal (localStorage) + submit
  idempotent, antrean foto di IndexedDB yang bertahan melewati muat ulang
  (DECISIONS 257), manifest installable, DAN service worker yang membuat
  `/foto-cepat` bisa DIBUKA dari nol tanpa sinyal (dengan banner "dari simpanan")
  sementara halaman lain jatuh ke `/offline` (DECISIONS 398). Halamannya
  disiapkan otomatis tiap aplikasi dibuka, jadi mode pesawat tidak menuntut
  Foto Cepat pernah dibuka lebih dulu (DECISIONS 399).
  Yang masih kurang: menu lain belum bisa dibuka luring (sadar — HTML ber-sesi yang
  menetap di HP adalah risiko, dan halaman lain tidak bisa ditindaklanjuti tanpa
  jaringan), background sync/unggah setelah aplikasi ditutup, dan push notification.
  Dua yang terakhir menuntut cangkang native (Capacitor/TWA), bukan peramban —
  lihat DECISIONS 398 untuk kenapa aplikasi Android penuh ditolak.
- 🟢 PR/PO/receiving granular (kini direpresentasikan Commitment+Expense).
- 🟢 Cash forecast otomatis dari baseline (fungsi `cashRequirement` ada; UI input
  forecast biaya belum).
- 🔵 **FUTURE — parse PDF undangan/penunjukan → buat prospek otomatis.** Surat KKP
  (mis. "Undangan Penunjukan Langsung") teks-asli memuat: nama paket, HPS total +
  rincian per-desa (= lokasi), vendor, provinsi, nomor/tanggal surat, target TTD
  kontrak. Alur: upload PDF → ekstrak teks → PRATINJAU (editable, kabupaten per-desa
  WAJIB dikoreksi manusia karena surat tak mengikat desa↔kab) → buat prospek + lokasi
  target. Rekomendasi: parser deterministik (regex, tanpa AI runtime — privasi dokumen
  pemerintah); LLM opsional bila format bervariasi. Belum tersedia kolom HPS per-lokasi.
  Tak mencakup PDF hasil scan (perlu OCR). Ditunda atas permintaan user (2026-07-24).

## Teknis

- 🟡 **UJI-01 · Uji integrasi masih meninggalkan data.** Sesudah suite integrasi
  penuh, 33 organisasi tertinggal di DB uji. Contohnya `weather-fetch.test.ts`, yang
  `afterAll`-nya hanya memutus koneksi. Belum ada yang gagal, tapi pemindai global
  (mis. antrean Drive) ikut menghitung sisa itu begitu urutan berkas bergeser. Itu
  persis yang membuat gerbang PR #380 merah (lima berkas dengan `DELETE` yang selalu
  gagal; sudah dibetulkan, dijaga `tests/unit/uji-integrasi-bersih.test.ts`). FIX:
  petakan berkas yang tidak membersihkan, lalu beri `TRUNCATE … CASCADE` di
  `afterAll`-nya. Pertimbangkan penjaga yang mewajibkan setiap berkas yang membuat
  organisasi juga membersihkannya.
- 🟡 **AI-01 (sisa) · Grok/xAI belum bisa menerima PDF dari MARLIN.** Jalur PDF
  OpenAI (`type:"file"`) dan Mistral (`type:"document_url"`) sudah dibangun dan
  diuji bentuk medannya (DECISIONS 435). xAI belum: PDF di sana tidak bisa
  disisipkan langsung di pesan – harus diunggah dulu lewat Files API lalu
  dirujuk `attachments:[{file_id}]`, alur dua langkah yang perlu penyimpanan
  file_id + pembersihannya. Sampai itu dibangun, teks layar berbunyi "MARLIN
  belum bisa", BUKAN "Grok tidak bisa".
- 🟢 **Ringkasan lokasi: hidrasi `PelaksanaForm` belum cocok.** Terlihat
  saat memverifikasi DECISIONS 436: `encType` server `null` vs klien
  `multipart/form-data`. Perlu reproduksi peramban untuk memastikan kondisi terkini.
- 🟡 **Laporan AI eksekutif: uji penerimaan manusia E-01…E-08 belum dijalankan.**
  Naskahnya di `docs/rebuild/SKENARIO_UJI_LAPORAN_AI_EKSEKUTIF.md` (DECISIONS
  453/454). Yang sudah tertutup uji otomatis: urutan bagian di keempat kanal,
  paritas angka layar/PDF/Excel/WA, peringatan data kosong, batas 3 keputusan /
  4 analisis, dan penyebutan sisa yang tidak ditampilkan. Yang MASIH butuh
  manusia: E-01 (pemahaman 30 detik oleh pembaca sungguhan), E-04 (apakah judul
  keputusan benar-benar dapat disetujui/ditolak/ditugaskan), E-07 (lifecycle
  edit → beku di peramban), dan E-08 (deploy Railway tanpa perintah manual).
- 🟡 **ESLint ditahan 9.39.5** — eslint-config-next 16 (eslint-plugin-react) belum
  kompatibel ESLint 10. Re-evaluasi tiap rilis Next.
- 🟡 **TypeScript ditahan 5.9.3** — TS 7 (native) belum diverifikasi dengan plugin Next.
- 🟢 `exceljs` maintenance lambat; buffers@0.1.1 transitive tanpa metadata lisensi
  (pengecualian terdokumentasi di OPEN_SOURCE_LICENSE_AUDIT.md).
- 🟢 Foto stamp memakai font DejaVu bundel; verifikasi otomatis foto (flag GPS/waktu)
  belum dievaluasi rutin (dedup sha256 jalan).
- 🟡 **UI-05 · Penjaga en-dash buta terhadap literal regex.**
  `tests/unit/tanda-pisah-ui.test.ts` memindai dengan tokenizer buatan sendiri
  yang hanya mengenal `//`, `/* */`, dan tiga jenis tanda kutip — literal regex
  tidak dikenali. Satu regex berisi tanda kutip **ganjil** (mis.
  `/filename="?([^";]+)"?/`) membalik parity-nya, dan SISA berkas terbaca sebagai
  isi string: komentar biasa pun dilaporkan sebagai pelanggaran em-dash.
  Ditemukan 2026-08-21 saat `menu-berkas.tsx` mendadak melanggar pada baris
  komentar yang sudah ada berbulan-bulan.
  Dampak: **false positive**, bukan lubang — jadi tidak ada em-dash yang lolos.
  Akalannya sekarang: tulis tanda kutip di dalam regex sebagai `\x22`/`\x27`.
  Perbaikan sesungguhnya butuh tokenizer yang bisa membedakan pembagian dari
  literal regex; belum dikerjakan karena harganya tidak sepadan dengan dampaknya.

## FUTURE · Serah terima parsial (PHO parsial per pekerjaan) — DECISIONS 078
Kontrak KNMP membolehkan PHO PARSIAL atas pekerjaan yang sudah 100% (mis. revetmen)
sebelum PHO final atas seluruh lokasi. Saat ini milestone PHO/FHO = induk tunggal.
Perlu: model serah terima parsial (per pekerjaan/kategori/lokasi selesai) + BA-nya,
tanpa mengganggu PHO/FHO final.

## FUTURE · Auto-flag termin berdasar progres agregat — DECISIONS 078
Sudah ada: kartu Kesiapan Termin menandai termin siap berdasar progres
(`lib/kesiapan`), dan retensi per termin (`ContractTermin.retensiPct`, DECISIONS 716).
Belum: opsi jaminan pemeliharaan sebagai pengganti retensi. Ambang kartu Kesiapan masih
konstanta – lihat "Ambang termin: dua sumber" di Pengendalian Terpadu.

## FUTURE · AI Hub — pekerjaan lanjutan yang sengaja ditunda (DECISIONS 133)
- E2E Playwright alur AI (PM buka hub → pulse → variance → report lifecycle →
  distribusi → Ask) belum ditulis — unit (34) + integration hijau.
- Rule quality tambahan: kandidat foto near-duplicate (butuh perceptual hash —
  byte-identik sudah dicegah sha256) dan spike volume harian abnormal. (Dokumen wajib
  per fase sudah ada di mesin kesiapan dari milestone.)
- "What changed vs periode sebelumnya" di Pulse masih dari data run yang sama;
  pembanding run sebelumnya (inputHash sama) belum di-feed ke prompt.
- Estimasi biaya: pricing per-provider (sekarang satu set harga global aktif).
- Rotasi AI_SECRET_ENCRYPTION_KEY: prosedur = set kunci baru + simpan ulang API
  key dari Sistem → AI (re-encrypt); belum ada tooling re-encrypt massal.
- Pemicu WhatsApp Paparan KKP ("@MARLIN buat paparan …", DECISIONS 416):
  DITUNDA sadar sampai jalur web stabil di produksi. Wajib memanggil
  `generatePaparan` yang sama (jangan service kedua), hanya membuat DRAFT,
  balasan berupa tautan review ber-autentikasi — bukan PDF ke grup.
- Distribusi artefak paparan (beku → terkirim) belum dibuka — unduh PDF final
  manual dulu; transisi `terkirim` sengaja ditolak di `transisiPaparanAction`.
- Kurva-S PAKET: builder calculation-layer-nya sudah ada (`gabungKurvaS`,
  DECISIONS 678), tetapi slide progres paparan belum memakainya dan merakit gabungan
  sendiri (`paparan/snapshot.ts`) – dua jalur kurva paket.

## FUTURE · Chat grup & kop surat — lanjutan (DECISIONS 135)
- Penjadwalan OTOMATIS ringkasan harian chat grup (tiap pagi utk H-1) — butuh
  scheduler; opsi: Railway cron job memanggil route internal. Perlu keputusan.
- Sinkronisasi ringkasan chat ke laporan: tampilkan di workspace lokasi/paket,
  ikut sebagai konteks exec-report & AI Hub (sumber "chat_grup" + sourceRef).
- Kop surat + logo di /cetak/*: cover harian & mingguan sudah ber-logo pelaksana,
  kop surat dipakai surat penyedia. Belum: `/cetak/ai` tanpa logo/kop, periodik
  bulanan memberi logo kosong, gambar kop vendor belum dipakai di header /cetak.

## PERF · Halaman cetak laporan mingguan lambat pada RAB besar (DECISIONS 151)
Lokasi dengan RAB ~1.700 baris item butuh ~22 detik untuk merender
`/cetak/periodik/<slug>/mingguan/<n>` di mode dev. Perhitungannya BUKAN
penyebabnya — `getPeriodReport` selesai 55–129 ms; sisanya render React untuk
1.657 baris tabel. Belum diukur di build produksi (dev Turbopack jauh lebih
lambat). Kalau di produksi masih terasa: opsi = virtualisasi/segmentasi tabel
per kategori, atau render PDF di server (jalur `lib/pdf/periodik.ts` sudah ada)
sebagai jalur cetak utama.

## 🟡 Kategori RAB tanpa item (DECISIONS 151, diperkuat audit M8)
`getPeriodReport` hanya membentuk kategori dari lineage ITEM yang ada. Kategori
RAB yang punya `amount` tetapi tidak punya item sama sekali tidak muncul di
tabel, sementara `amount`-nya tetap masuk `grandTotal` — akibatnya Σ bobot item
< 100%. Belum pernah terlihat pada data nyata (importer selalu membuat item),
dan uji integrasi menjaga Σ bobot = 100 untuk RAB normal. Sejak audit 2026-07-27 ada uji integrasi yang menjaga `Σ amount kategori ==
Σ amount item` pada revisi aktif, jadi drift akan ketahuan. Kalau suatu saat
kondisinya muncul di data nyata, keputusannya: tampilkan kategori kosong dengan
bobot 0, atau keluarkan `amount`-nya dari `grandTotal`. Perlu keputusan user.

## 🟡 FOTO-01 · Pemulihan berkas snapshot historis yang sudah terhapus

Jalur penggantian foto sudah mempertahankan versi lama (audit 2026-09-14,
`docs/audits/2026-09-14-keamanan-integritas.md`). Restamp, rotasi, konversi
HEIC, dan pelengkapan cap tidak lagi menghapus versi yang mungkin dipakai
snapshot laporan/paparan. Pembersihan hanya melalui audit R2 yang sudah ada.

Yang masih terbuka: inventarisasi snapshot produksi yang terlanjur menunjuk
obyek hilang dan pemulihan dari cadangan jika tersedia. Perbaikan kode tidak
mengembalikan obyek terhapus. Jangan mengganti isi snapshot final dengan versi
foto baru secara diam-diam. Ketidakcocokan kunci snapshot dengan kolom `photos`
saja bukan bukti kehilangan; keberadaan obyek perlu diperiksa di bucket.

## 🟡 FOTO-03 · Salinan Lenovo berkas ASLI yang tertinggal sebelum DECISIONS 705

Sejak 705 semua jalur hapus foto dan "hapus arsip asli" ikut menghapus salinan
Lenovo berkas asli (FOTO-02 selesai). Yang tertinggal SEBELUM itu belum
disapu, dan tidak bisa ditemukan dari MARLIN saja:

- gateway Lenovo tidak punya fungsi daftar berkas (DECISIONS 554, tidak dibongkar);
- foto yang dihapus sudah tidak punya baris; "hapus arsip asli" mengosongkan
  `originalKey`, jadi kuncinya ikut hilang (yang tersisa hanya
  `originalPurgedAt` + `originalArchivedAt` terisi – bisa DIHITUNG, tidak bisa
  ditunjuk berkasnya);
- DELETE gateway menuntut sidik jari isi, yang untuk berkas tanpa baris juga
  sudah tidak diketahui.

Jalan yang tersisa: sapu dari sisi Lenovo – bandingkan isi direktorinya dengan
daftar kunci yang MASIH dipakai MARLIN (berkas asli ber-`originalArchivedAt`
dengan `originalKey` terisi + `berkas_pindah.kunciDingin`), lalu buang sisanya.
Butuh keputusan user sebelum dibuat: penghapusan di mesin arsip tidak bisa
dibatalkan, dan cadangan Drive (650) sengaja tidak pernah dihapus otomatis.

## 🟡 TAGIH-01 · Berkas termin belum sama persis dengan berkas yang lolos (DECISIONS 725)

Patokan: TERMIN 1 CV. Putera Fahlevi (sudah dibayar). Yang masih beda:

- **Dokumentasi**: berkas lolos berisi foto mentah per item pekerjaan per desa
  ("8. Dokumentasi Pekerjaan Per Item/DOKUMENTASI - <DESA>/<pekerjaan>/…"). MARLIN masih
  mengirim satu PDF dokumentasi 0–50–100 per desa ke folder itu. FIX: salin/shortcut foto
  per kelompok pekerjaan (pola shortcut DECISIONS 666), tanya user dulu foto mana yang dipilih.
- **Daftar periksa xlsx** yang ada di berkas lolos belum dibuat.
- Salinan versi sendiri di folder T (T6/T9/…) dari tekanan "Siapkan berkas" sebelum 725 tidak
  dibuang otomatis (722) – kalau ada, rapikan tangan.

## 🟢 MINGGU-01 · "Laporan mingguan" di Tanya MARLIN WA tetap pekan Senin–Minggu (DECISIONS 708)

Sejak 708 periode minggu kontrak bisa dimulai hari apa saja. Pertanyaan WA
"laporan mingguan minggu lalu" (`pekanDari`, DECISIONS 358) masih menjawab
pekan KALENDER Senin–Minggu, bukan periode kontrak paket itu. Satu pertanyaan
bisa mencakup beberapa paket dengan periode berbeda, jadi tidak ada satu
"minggu kontrak" yang bisa dipakai. Laporan Progres Mingguan resmi (grup WA,
PDF, Excel) sudah mengikuti periode kontrak; yang belum hanya jawaban Tanya
MARLIN ini. Perlu keputusan bila ada keluhan: ikut periode paket bila
pertanyaannya menyebut satu paket/lokasi, atau tetap Senin–Minggu.

## KEPUTUSAN · Level status progress belum dipisah (Calculation Integrity Protocol)

```text
CONFLICT:
  Protokol menuntut tiga level progress yang dibedakan; sistem hanya punya satu.
SOURCE A (protokol):
  reportedProgress = dikirim + disetujui + final
  verifiedProgress = disetujui + final
  frozenProgress   = final
  Label generik "Realisasi" DILARANG; harus "Progress Dilaporkan" /
  "Progress Terverifikasi" / "Progress Final".
SOURCE B (kode):
  COUNTED_REPORT_STATUSES = [dikirim, disetujui, final] — basis RESMI, dipakai
  dashboard, blanko KKP, kurva-S, keuangan (installedValue), dan AI. UI
  melabelinya "Realisasi" di ±12 tempat.
  UPDATE DECISIONS 426: opsi 2 SUDAH terpasang sebagai angka PENDAMPING —
  `statusLevel: "terverifikasi"` (disetujui+final) di getLocationsProgress,
  dipakai mesin kesiapan termin/PHO. Basis resmi TIDAK berubah; yang masih
  menunggu keputusan tinggal opsi 3 (memindahkan basis resmi).
BUSINESS IMPACT:
  Angka yang diteken PPK saat ini memasukkan laporan yang BARU DIKIRIM dan
  belum diverifikasi siapa pun. Pembaca tidak bisa membedakannya. Untuk
  penagihan termin, "terpasang" idealnya memakai level terverifikasi.
SAFE OPTIONS:
  1. Biarkan satu level, perjelas labelnya saja jadi "Realisasi (dilaporkan)".
     Murah, tidak mengubah angka mana pun.
  2. Tambah verifiedProgress sebagai angka KEDUA yang ditampilkan berdampingan;
     angka utama tetap seperti sekarang. Tidak ada regresi, tapi dua kolom baru
     di dashboard/laporan.
  3. Pindahkan basis resmi ke verifiedProgress. Paling benar secara kontrak,
     TAPI seluruh angka historis turun dan blanko KKP yang sudah dikirim ke KKP
     tidak lagi cocok dengan sistem. Butuh backfill + pengumuman.
RECOMMENDATION:
  Opsi 1 sekarang (label), opsi 2 kalau KKP/PPK memang meminta pemisahan.
  Opsi 3 hanya bila diputuskan bersama KKP — bukan keputusan teknis.
DECISION REQUIRED:
  Hery: apakah "Realisasi" di dashboard & blanko boleh berisi laporan yang
  belum diverifikasi? Kalau tidak, pilih opsi 2 atau 3.
```

Sampai diputuskan, kode TIDAK diubah: mengganti level status diam-diam persis
yang dilarang protokol.

## KEPUTUSAN · `dataAsOf` belum melekat di setiap angka (CIP; audit M5)

Protokol meminta tiap angka membawa metadata (`dataAsOf`, `calculationKey`,
`statusLevel`, `revisionId`, `baselineId`, `sourceEntityIds`) supaya bisa
di-drill-down. `dataAsOf` kini ada di AI Hub Pulse dan paparan; dasbor dan laporan
lain belum.

Opsi (a) sudah terpasang: `getLocationProgress(id, { asOf })` menyaring laporan
≤ `asOf` dan minggu rencananya ikut `asOf` (dipakai snapshot harian, paparan, surat
penyedia), jadi "berapa angkanya per 30 Juni?" sudah bisa dijawab di kode. Ini soal
ketertelusuran, bukan kebenaran angka.

Sisa pilihan: (b) label "s.d. hari ini" pada setiap KPI dashboard (murah, baru ada di
sebagian tempat); (c) presentation contract berlabel penuh lintas modul (refactor
besar). Perlu keputusan.

## 🟢 Jadwal asumsi (SPMK belum terbit) tidak ditandai di output (audit M9)

`getPeriodBounds(locationId, { assume: true })` mengasumsikan kontrak mulai HARI
INI ketika SPMK belum ada, supaya kurva-S rencana tetap bisa dilihat. Flag
`assumed` sudah ditandai di Cetak Jadwal, Cetak Rencana-Realisasi, PDF jadwal, dan
kurva paket (membaca `bounds.assumed`). Belum: `PeriodReport` tanpa `assumed`, sehingga
Unduh Excel jadwal (`jadwal/export`), `jadwal/rincian`, dan `rencana-realisasi/export`
tidak memberi tanda bahwa tanggalnya karangan. Laporan periodik resmi tidak terpengaruh
(dipanggil tanpa `assume`).

## 🟢 Pembulatan belum seragam antar layer (audit L9, L10)

- `pct()` dan `bobotPct()` mengubah uang `BigInt` → `Number`. Aman untuk rupiah
  (jauh di bawah 2^53) tetapi melanggar aturan "jangan ubah BigInt uang jadi
  Number tanpa alasan" — alasannya perlu ditulis eksplisit atau polanya diganti.
- SQL memakai `::bigint` (Postgres: round-half-away-from-zero), TS memakai
  `Math.round` (half-up). Berbeda arah hanya pada nilai negatif tepat `.5`.
  Tidak terjangkau alur normal (volume negatif ditolak di input), tetapi kalau
  suatu saat koreksi negatif diizinkan, ini harus diseragamkan lebih dulu.

## 🟢 Paritas output belum diuji untuk PDF / Excel / WhatsApp / AI (audit E)

PDF, Excel, komponen cetak, dan payload AI semuanya mengonsumsi objek
`PeriodReport` / `getLocationsProgress` yang sama, jadi kesamaannya bersifat
struktural. Tetapi tidak ada test yang MEMBUKTIKAN angka di file hasil render
sama dengan angka di layar. Kalau suatu saat ada yang menyisipkan pembulatan di
renderer, tidak ada yang menangkapnya. Sudah ada pengecekan per berkas (KPI Excel AI =
brief, cache REKAP KKP, cache Jumlah RAB = angka tersimpan); yang belum: angka di PDF
dan WA, dan uji lintas kanal "satu `PeriodReport` → layar = PDF = Excel = WA".

## Audit total 2026-07-27 — sisa yang sengaja di-defer (P0 di DECISIONS 154, P1/P2 di DECISIONS 155)

Semua temuan B1–B19 sudah dikerjakan (lihat DECISIONS 154–155). Yang tersisa
adalah defer eksplisit + item yang butuh keputusan:

- 🟡 **UI — migrasi primitif Modal/Drawer penuh**: `ui/drawer.tsx` dan `ConfirmSubmit`
  sudah mengurung fokus + Escape, tetapi masih 11 dialog buatan sendiri
  (`role="dialog"`) tanpa primitif bersama, dan latar `inert` belum dipakai di mana pun.
- 🟢 **UI — token tipografi**: skala font de-facto belum diangkat jadi token – kini
  1.011 kemunculan `text-[Npx]` di 204 berkas (dulu 262); 157 `<button>` mentah belum
  dimigrasi ke `Button`.
- 🟢 **UI — a11y lanjutan**: combobox belum `aria-activedescendant`; toggle
  lihat-password belum focusable; token warna khusus cetak belum ada.
- 🟢 **Paritas render**: belum ada test yang membuktikan angka PDF/Excel/WA/AI ==
  layar (lihat bagian "Paritas output" di atas).
- 🟡 **B17 (bagian transaksi)**: aktivasi revisi + regenerate baseline masih 2
  transaksi. Kegagalan regenerate kini DILAPORKAN jujur ke user (bukan error
  generik) + jalur pemulihan ("Hitung ulang kurva-S"); penyatuan ke satu
  transaksi DB (ribuan node + baseline) di-defer.

## KEPUTUSAN · Basis penagihan termin: level status (audit B4+B5)

PPN sudah dibereskan best-practice (DECISIONS 155): `unbilled` kini membandingkan
apel-ke-apel — terpasang di-gross-up ke incl-PPN via `Contract.ppnPercent`
sebelum dikurangi billing (incl-PPN). Yang MASIH menunggu keputusan: basis
terpasang memakai level COUNTED (dilaporkan) atau VERIFIED — ini bagian dari
KEPUTUSAN "Level status progress" di atas, bukan keputusan terpisah.

## UX-01 · `loading.tsx` masih terhalang: `router.refresh()` tidak selesai di balik batas Suspense (DECISIONS 245)

🟡 — menahan perbaikan UX yang sudah terbukti dibutuhkan.

Saat memperbaiki "di mobile menu diklik terasa stuck", obat bakunya adalah
menambahkan `loading.tsx` supaya App Router punya batas Suspense dan bisa
menukar layar ke kerangka SEKETIKA (sekaligus membuka pra-ambil cangkang
statis tiap tautan menu). Sudah dicoba, lalu DITARIK LAGI.

Sebabnya: dengan `src/app/(app)/loading.tsx` terpasang, panel persetujuan
adendum berhenti merespons. Alurnya di
`lokasi/[slug]/rab/adendum/draft-controls.tsx` — server action lalu
`router.refresh()` di dalam `startTransition`. Begitu ada batas Suspense di
atasnya, refresh itu tidak pernah selesai: sesudah "Setujui aktivasi" ditekan,
tombolnya tinggal diam >15 detik dan tidak berganti jadi "Cabut persetujuan
saya".

Terukur, bukan dugaan: `tests/e2e/adendum-empat-mata.spec.ts` lulus 5/5 tiga
kali berturut-turut (±23 detik) tanpa `loading.tsx`, dan gagal 2-3 dari 5
setiap kali dengan `loading.tsx` — dibisect per berkas, dan komponen umpan
balik navigasi (`components/shell/nav-progress.tsx`) terbukti BUKAN
penyebabnya (5/5 dua kali dengannya, tanpa `loading.tsx`).

Ini cacat yang KELASNYA SAMA dengan yang sedang diperbaiki — layar diam
sesudah ditekan — hanya pindah dari navigasi ke layar yang jauh lebih
berbahaya (persetujuan perubahan nilai kontrak). Karena itu yang dikirim hanya
umpan balik navigasi; kerangka halaman ditunda.

**Untuk dikerjakan**: cari sebab `router.refresh()` menggantung di balik batas
Suspense (kandidat: refresh dipanggil di dalam transition yang sama dengan
server action-nya; alternatifnya `revalidatePath` saja tanpa `router.refresh()`,
atau pindahkan refresh keluar dari `startTransition`). Sesudah itu barulah
`loading.tsx` bisa dipasang — dan uji adendum di atas yang jadi pagarnya.

## DATA-02 · Kolom `Photo.verification` usang, tinggal di-drop (DECISIONS 250)

🟢 — sudah tidak berbahaya, tinggal dibersihkan.

Sejak status foto diturunkan dari laporan/kegiatan induknya, kolom
`Photo.verification` (dan enum `PhotoVerification`) tidak lagi dibaca maupun
ditulis kode mana pun. Skemanya sudah ditandai USANG supaya tidak dihidupkan
lagi.

**Belum di-drop** karena isinya di produksi belum diperiksa. Kode hanya pernah
menulis `pending`, jadi kemungkinan besar seluruh baris bernilai itu — tapi itu
dugaan, bukan hasil pemeriksaan, dan migrasi drop tidak bisa dibatalkan.

**Langkahnya**: jalankan `select verification, count(*) from photos group by 1`
di produksi. Bila semuanya `pending`, buat migrasi yang men-drop kolom dan
enumnya. Bila ADA nilai lain, berarti pernah ada jalur yang menulisnya di luar
kode saat ini — telusuri dulu sebelum menghapus apa pun.

## 🟢 PLAN-01 · Rencana mingguan belum masuk arsip Google Drive (DECISIONS 258/259)

WhatsApp SUDAH tersambung (DECISIONS 259: teks berisi rencana + PDF formulir
ke grup WA paket). Yang belum: unggah otomatis/manual ke folder Google Drive
paket seperti laporan harian & periodik (`lib/drive`, DECISIONS 137/138),
sehingga rencana mingguan tidak ikut terarsip di struktur 9 folder KKP.

## 🟡 LBL-01 · Cap "FINAL — ANGKA TERKUNCI" mencakup angka yang TIDAK terkunci (DECISIONS 275)

PDF *Ringkasan Pelaksanaan Harian* memasang spanduk **"FINAL — ANGKA TERKUNCI"**
di atas seluruh halaman. Untuk sebagian besar isinya cap itu benar: item
pekerjaan, volume, nilai hari itu, dan realisasi s/d tanggal dokumen memang
dibekukan ke `finalSnapshot` saat finalisasi.

Tapi **Rencana kurva-S dan Deviasi tidak dibekukan**. Sejak DECISIONS 275,
keduanya sengaja mengikuti baseline yang berstatus `aktif` — jadi mengganti
kurva-S akan menggeser dua angka itu pada dokumen yang sudah final, sementara
spanduk di atasnya menyatakan seluruh angka terkunci.

Ini soal KATA-KATA, bukan angka: perilaku angkanya sudah diputuskan dan
dibenarkan user ("baseline kurva-s aktif yang mana, itu yang dipakai dasar").
Yang salah adalah cap yang menjanjikan lebih dari yang dijamin sistem.

**Pilihan perbaikan** (butuh keputusan user):

1. Persempit capnya — mis. "FINAL — realisasi terkunci", lalu beri catatan kecil
   pada baris rencana/deviasi bahwa keduanya mengikuti kurva-S yang berlaku.
2. Bekukan juga `planPct`/`deviationPct` ke `finalSnapshot` — tapi ini berlawanan
   dengan DECISIONS 275, karena dokumen final lalu bisa memuat rencana yang
   berbeda dari kurva-S yang berlaku sekarang.

Rekomendasi: **opsi 1**. Yang dibekukan adalah apa yang dilaporkan lapangan;
rencana adalah tolok ukur yang memang boleh direvisi, dan justru itu gunanya
revisi baseline.

## 🟡 CALC-05 · Laporan periodik KKP tidak membatasi laporan menurut periode versi (DECISIONS 275)

`periodic-report.ts` memilih baseline dengan `status: "aktif"` tanpa `asOf` sama
sekali. Sejak DECISIONS 275 itu justru SESUAI aturan yang berlaku (dasar =
baseline aktif), jadi bukan lagi ketidakkonsistenan — dicatat di sini supaya
tidak "diperbaiki" oleh pembaca berikutnya menjadi pemilihan versi per tanggal,
yang persis sudah dibuang.

Yang masih perlu diperiksa terpisah: apakah pembatasan LAPORAN menurut periode
(`report_date` dalam rentang periode) sudah benar di seluruh jalur laporan
periodik — itu soal waktu, bukan soal versi, dan tidak ikut terjawab oleh 275.
Diperiksa 2026-11-06: realisasi, laporan periode, dan kendala diiris per periode di satu
fungsi `getPeriodReport` (dipakai cetak, unduhan, WA), dan batas mingguan diuji
(*Date-as-of gate*). Yang belum: uji batas tanggal **bulanan**.

## 🟡 GDRV-01 · Pemilihan tautan Drive bergantung pada NAMA berkas (DECISIONS 278)

Papan status harian memilih tautan "Buka Drive" dengan memeriksa apakah nama
berkasnya diawali "Laporan Harian" — supaya tombolnya membuka blanko laporan,
bukan foto yang kebetulan diunggah paling akhir.

Bergantung pada nama berkas itu rapuh: kalau format penamaan PDF harian diubah
(mis. diberi awalan nomor paket), pemilihannya meleset dan tombolnya kembali
membuka foto — **tanpa galat apa pun**, persis kegagalan senyap yang baru saja
diperbaiki.

**Perbaikan yang benar**: tambahkan kolom `jenis` (mis. `laporan` | `foto` |
`dokumen`) pada `GDriveUpload`, isi saat mengunggah, dan pilih tautan
berdasarkan kolom itu. Butuh migrasi + backfill (baris lama bisa ditebak dari
`fileName` sekali saja), karena itu tidak digabung ke perubahan kecil ini.

## 🟡 TTD-02 · Posisi gambar di PDF dipatok dari tinggi baris, bukan dari posisi baris nama

Di PDF, koordinat tempat gambar dijatuhkan (`yTtd + 46` di harian, `o.y + 44` di
periodik) dihitung dari tinggi blok, bukan dari posisi baris nama yang
sesungguhnya — pdfkit tidak mengembalikan posisi baris di dalam sel `gridRow`.

Kalau nama penanda tangan panjang sampai membungkus dua baris, blok memanjang ke
bawah sementara gambarnya tetap di tempat lama, sehingga coretan bisa menumpuk
teks. Belum terlihat pada nama-nama yang ada sekarang. Perbaikan yang benar:
`gridRow` mengembalikan posisi tiap baris teks, bukan hanya `y` akhir.

## 🟡 CETAK-01 · Dua penyaji untuk satu dokumen: halaman cetak HTML vs PDF (DECISIONS 334)

Laporan periodik, harian, dan rencana mingguan masing-masing punya DUA penyaji
yang menghasilkan dokumen yang sama: komponen React di `/cetak/...` (di-Ctrl+P
dari peramban) dan pembangun pdfkit di `lib/pdf/...`. Kodenya sendiri menyebut
yang kedua *"cermin komponen layar"*.

Risikonya sudah terbukti nyata di repo ini: dua penyaji untuk satu dokumen
selalu menyimpang (DECISIONS 241, 267), dan yang ketahuan belakangan justru
sesudah dokumennya dikirim ke PPK.

**Perbaikan yang benar**: tombol "Cetak" cukup membuka PDF-nya, lalu penyaji
HTML dihapus — satu sumber, mustahil menyimpang. Belum dikerjakan karena
halaman `/cetak/...` juga dipakai sebagai PRATINJAU di layar (dan pratinjau PDF
di peramban ponsel lapangan belum dipastikan bisa diandalkan). Keputusan user.

**Sejak DECISIONS 668** Time Schedule juga punya dua penyaji (`/cetak/jadwal` dan
`renderJadwalKkpPdf`, lembar kurvanya memakai fungsi gambar yang sama dengan
laporan periodik). Di aplikasi terpasang tombol cetak sudah membuka PDF-nya;
di peramban biasa masih halaman HTML.

## 🟡 UJI-01 · `tugas-harian.test.ts` tidak bisa dijalankan dua kali berturut-turut

Ditemukan 2026-08-19 saat menelusuri kegagalan yang tampak tidak berhubungan.

Berkas itu sengaja TIDAK membersihkan fixture-nya (histori tahap & status
bersifat append-only), sementara beberapa ujinya menegaskan hasil fungsi yang
menyapu **seluruh** basis data. Akibatnya paket sisa RUN SEBELUMNYA ikut
terhitung.

Terbukti pada `HEAD` bersih, tanpa perubahan apa pun: basis data dikosongkan →
18 lulus; dijalankan lagi tanpa dibersihkan → 1 merah. Merahnya di uji yang
sama sekali tidak menunjuk ke sebabnya.

**Sudah diperbaiki sebagian** (DECISIONS 381): dua penegasan SPMK kini
memeriksa **nama paketnya sendiri** (`hasil.paket`), bukan hitungan global —
lebih kuat, sekaligus kebal baris asing.

**Belum beres** (diperiksa ulang 2026-11-06): uji `PAKSA mengirim ulang di hari yang
sama` kini menyaring lewat `punyaKita()` per alamat WA penerima, tetapi setiap run
membuat SM dengan nomor WA yang SAMA dan penugasan run lama tidak dilepas, jadi pesan
ke SM run lama ikut terhitung (diharap 2, dapat 3). Perbaikannya: saring dengan
identitas fixture run itu sendiri (userId atau nomor unik per run).

Dalam rangkaian penuh `pnpm vitest run tests/integration` semuanya hijau
(berkas lain mem-`TRUNCATE` lebih dulu). Gejalanya hanya muncul saat berkas itu
dijalankan sendirian berulang kali.

## FUTURE · Pengendalian Terpadu — lanjutan yang sengaja ditunda (DECISIONS 426)

Fase pertama (temuan, inspeksi, verifikasi eksternal, kesiapan, EWS) selesai;
yang berikut DITUNDA SADAR supaya fase pertamanya bisa diuji dulu:

- 🟢 **Evidence explorer global** — bukti kini terlihat per temuan/inspeksi +
  galeri `/foto` + register `/dokumen`; layar pencarian gabungan lintas modul
  (lokasi × tanggal × tipe × status verifikasi) belum dibuat.
- 🟢 **Unggah foto langsung dari form inspeksi** — kini inspeksi menautkan
  foto yang sudah ada (Foto Cepat tetap jalur jepret). Unggah langsung butuh
  jalur kompresi+cap yang sama dengan laporan harian.
- 🟢 **E2E Playwright alur temuan/verifikasi** — unit + integrasi hijau;
  E2E menyusul (pola defer yang sama dengan AI Hub).
- 🟡 **Ambang termin: dua sumber.** Ambang per kontrak sudah menjadi data
  (`ContractTermin.ambangPct`, DECISIONS 716/717) dan dipakai penagihan & surat, tetapi
  `/kesiapan` masih memakai konstanta 25/50/80/100 (`AMBANG_TERMIN_PCT`,
  `lib/kesiapan/rules.ts`). Kontrak yang jadwal terminnya diubah diberi ambang keliru
  di kartu Kesiapan. FIX: `/kesiapan` membaca jadwal termin kontrak.
- 🔵 **EWS "GPS di luar radius" & "pekerjaan tanpa evidence"** — rule kualitas
  data ini sudah ada di ai-hub (`quality-rules.ts`); menyalinnya ke
  /perlu-tindakan berarti dua rumah untuk rule yang sama. Keputusan yang
  benar: satu keluarga rule dipakai dua permukaan — refactor kecil, belum
  dikerjakan.


## RAPL — sisa setelah RAPL-01…RAPL-08 ditutup (DECISIONS 475/476)

Kedelapan temuan audit 2026-08-29 sudah dikerjakan (DECISIONS 476). Yang
BELUM, dan sengaja disebut supaya tidak terbaca sebagai selesai seluruhnya:

- 🟡 **Lembar cetak A4 RAPL masih bentuk agregat.** `/cetak/rapl/[slug]`
  (`src/components/knmp/rapl-lembar.tsx`) menyajikan biaya per KATEGORI sumber
  daya; rincian per item baru ada di layar dan di lembar Excel "Rincian per
  item". Kertas A4 tidak muat memuat ratusan item apa adanya, jadi bentuknya
  perlu diputuskan lebih dulu — daftar item yang RUGI saja, atau lampiran
  berhalaman. Keputusan tampilan, bukan keputusan kode.
- 🟢 **Permintaan draf harga AI yang menggantung tidak dijemput ulang.**
  Kalau proses mati di tengah (deploy ulang), layar menyatakan permintaannya
  TERPUTUS dan orang menekan tombolnya lagi — satu ketukan. Ask MARLIN punya
  penjemput (`jemputTanyaTertunda`, DECISIONS 456) karena di sana ongkos
  gagalnya adalah mengetik ulang pertanyaan. Di sini belum dibuat karena
  ongkosnya tidak sebanding; kalau ternyata sering terjadi, polanya sudah ada
  tinggal disalin.
- 🟢 **Kolom draf harga AI belum punya jalur E2E.** Perbaikan 2026-08-30
  (DECISIONS baru: kolom mengikuti keadaan) dijaga uji unit atas fungsi murni
  `kolomHarga`, BUKAN atas grid yang benar-benar dirender: seed pengembangan
  tidak punya basis AHSP maupun draf harga AI, jadi tidak ada jalan menuju layar
  itu di Playwright. Yang belum terbukti karenanya: bahwa kolom "Usulan AI"
  memang terlihat tanpa gulir mendatar di peramban sungguhan. Menutupnya menuntut
  seed yang memuat basis AHSP + satu draf usulan.
- 🟢 **Kronologi belum diuji penuh di basis data sungguhan.** `ambilKronologi` kini
  ikut teruji tidak langsung lewat `lokasi-lengkap-snapshot.test.ts`, tetapi hanya
  pengelompokan per bulan. Yang belum terbukti: pemetaan `closedAt`/`createdAt` ke
  tanggal Asia/Jakarta, dan saringan `mergedIntoId: null` (fixture belum memuat kendala
  kembar).
- 🟢 **Grid RAPL lain belum diukur lebarnya.** Yang dirapikan baru "Kebutuhan &
  harga". `rapl-padanan` dan `rapl-rincian-item` memakai pola kolom yang sama dan
  bisa saja melewati lebar layar dengan cara yang sama – belum diperiksa.

---


## PROGRES AGREGAT PAKET DIHITUNG ATAS TIGA POPULASI BERBEDA (2026-09-16)

Ditemukan saat menambahkan kolom progres agregat di daftar paket. Rumusnya
sama di mana-mana (`weightedRealizedPct`), tetapi POPULASINYA tidak:

| Tempat | Scope penugasan | Lokasi dicabut adendum |
|---|---|---|
| `/paket/[id]` KPI "Progress agregat" | ikut disaring | DIKELUARKAN |
| `/paket` kolom "Progress agregat" (baru) | ikut disaring | DIKELUARKAN |
| `/kesiapan` "Progress dilaporkan" (`lib/kesiapan/builder.ts`) | **tidak** | **ikut terhitung** |
| Gerbang serah terima (`aggregateProgressPct`, `lib/package/actions.ts`) | **tidak** | **ikut terhitung** |

Akibatnya untuk paket yang mencabut lokasi lewat CCO, `/kesiapan` dan peringatan
serah terima menyebut angka yang berbeda dari halaman paket. Yang paling tajam:
banner di layar memakai angka yang SUDAH tersaring sementara gerbang yang
menolak transisinya memakai yang BELUM – satu kalimat, dua angka.

Temuan sejalan dari tinjauan yang sama: untuk paket yang BELUM punya RAB aktif,
daftar paket menulis "belum ada RAB aktif" sementara KPI di halaman ringkasan
menulis "0,0%" untuk paket dan detik yang sama. Kata yang benar ada di daftar;
KPI-nya yang layak menyusul, tetapi itu perubahan pada layar lain.

Belum diperbaiki karena menyentuh gerbang siklus paket: menyaring lokasi dicabut
di gerbang serah terima akan MEMPERMUDAH paket tuntas, dan itu keputusan user,
bukan koreksi kode. Ditanyakan terpisah.

---

## AUDIT-DEV-2026-09-15 · sisa temuan (SELURUH kritis & tinggi sudah ditutup)

Audit menyeluruh branch `dev` atas permintaan user (laporan harian + aliran
datanya, RAB, adendum). Laporan lengkap — skenario, bukti `file:baris`, usul
perbaikan, dan hasil reproduksi merah-dulu tiap temuan — ada di
[`docs/rebuild/AUDIT_DEV_2026-09-15.md`](rebuild/AUDIT_DEV_2026-09-15.md).

74 terkonfirmasi (3 kritis · 23 tinggi · 37 sedang · 11 rendah), 9 terbantah,
7 belum sempat diverifikasi.

**Seluruh 26 temuan kritis & tinggi sudah diperbaiki**, masing-masing dengan uji
MERAH-DULU yang diverifikasi gagal tanpa perbaikannya (DECISIONS 577 & 578).
Yang tersisa untuk dikerjakan: **37 sedang + 11 rendah**, semuanya di laporan
audit — belum didaftar ulang di sini supaya berkas ini tidak menjadi salinan
kedua yang bisa menyimpang. Diperiksa ulang 2026-11-06: enam sudah beres – A-7, B-5,
G-7, H-2, serta D-4 dan E-5 (jalurnya diganti DECISIONS 728); 42 sisanya masih
terbuka.

**Jangan menutup satu pun tanpa uji MERAH-DULU** — sebagian besar sudah punya
reproduksinya di laporan, tinggal dijadikan tes tetap.

---

## ADENDUM — temuan audit 2026-09-01 yang BELUM ditutup

Audit menyeluruh jalur adendum (perbandingan · persetujuan · parser/ekspor)
dipicu laporan user tentang peringatan "harga satuan 9 item berubah" yang palsu.
Yang sudah diperbaiki ada di DECISIONS (peringatan berbasis rupiah · otorisasi
lokasi · pagar realisasi · kategori menggugurkan tanda tangan). Sisanya di bawah.
Setiap butir diverifikasi dengan membaca kode; yang masih dugaan ditandai.

### Perbandingan & pencocokan identitas

- 🟡 **KEPUTUSAN · Pemetaan manual item yang BERGANTI NAMA tapi maksudnya sama.**
  Pertanyaan user 2026-09-02: *"ada satu kondisi dimana item yang sudah diinput
  pada laporan harian ternyata berubah teks tapi maksudnya sama, apakah ini bisa
  diakomodir? atau dipetakan ke item baru di draft perubahan."* Secara alur
  MEMUNGKINKAN: pratinjau impor sudah menghitung "item hilang yang punya
  realisasi" dan "item baru", dan `samakanLineage` sudah bisa memaksakan sebuah
  `lineageKey`. Layar memilih pasangannya sudah ada (pemetaan manual di pratinjau
  impor); yang belum adalah tempat menyimpan pilihan itu – kini sekali pakai per impor,
  jadi berkas pengganti menanyakan ulang. Perlu diputuskan: disimpan sebagai data
  (tabel padanan lineage) atau tetap sekali pakai.

- 🟡 **Satuan tidak pernah dibandingkan.** `NodeAktif` tidak punya field `unit`,
  jadi item yang satuannya berubah m² → m³ dengan angka volume sama persis
  dihitung **"tetap"**. Di `cocok-lineage.ts` satuan hanya menyaring bila
  kandidatnya lebih dari satu, jadi ia tidak pernah jadi veto dan perbedaannya
  tidak dilaporkan di mana pun.
- 🟡 **`kind: "grup"` di luar seluruh perbandingan.** `bandingkanTerhadapAktif`
  menyaring `kind === "item"`, sedangkan `flatten` memberi `kind: "grup"` pada
  item yang punya anak — lengkap dengan volume dan harganya. Item daun yang
  di berkas baru dapat anak dilaporkan "item hilang" (alarm palsu); grup yang
  jadi daun berharga dilaporkan "item baru" dan harganya tidak dibandingkan
  dengan apa pun.
- 🟢 **`normalNama` terlalu tipis.** "Urugan Pasir t=3 cm" vs "t = 3 cm"
  terbaca dua pekerjaan berbeda; `m2`/`m²` dan `-`/`–` juga tidak dirapikan.

### Parser & ekspor

- 🔴 **KEPUTUSAN · Dokumen CCO memakai harga LAMA untuk kedua blok.**
  `cco-rows.ts` `hargaLama: (l ?? b)!.unitPrice`, dan berkasnya cuma punya SATU
  kolom harga yang dipakai semua rumus. Item volume tetap dengan harga 1 jt →
  1,5 jt: MARLIN menghitung TAMBAH Rp 1 juta, berkas yang dikirim ke PPK menulis
  **TETAP** dengan kolom tambah kosong. Kenaikannya tidak ada di dokumen.
  Belum ditutup karena memperbaikinya berarti **mengubah bentuk dokumen yang
  dikirim ke KKP** (kolom harga lama + harga baru, atau baris terpisah) — itu
  keputusan format, bukan keputusan teknis. Catatan: harga item kontrak lama
  memang tidak boleh berubah (DECISIONS 213), jadi keadaan ini sendiri sudah
  janggal; pertanyaannya bagaimana dokumen harus menampilkannya kalau terjadi.
  Sebagian sudah: blok CCO-01 memakai harga berkas, kolom TAMBAH dihitung dari selisih
  nilai, selnya ditandai, dan ada baris rekonsiliasi. Masih: KET tertulis "TETAP" untuk
  volume tetap dengan harga naik, dan tetap satu kolom harga.
- 🟡 **Harga yang diubah user dipakai untuk harga, diabaikan untuk uang.**
  `adendum-template-parse.ts` menguji `tetap` hanya dari VOLUME, lalu memakai
  `jumlahKontrak` lama sebagai `amount` — padahal kolom Harga Satuan sengaja
  dibuka untuk diketik. Node jadi melanggar identitasnya sendiri
  (`amount ≠ volume × unitPrice`), dan layar menampilkan "dampak neto Rp …"
  sementara Total baru tidak bergerak sama sekali.
- 🟡 **Nilai ter-cache di template bertentangan dengan rumusnya sendiri.**
  Kolom H diisi cache `amount` tersimpan padahal rumusnya `ROUND(G*E,0)`, dan
  DECISIONS 212 menyatakan keduanya memang berbeda. Kolom "Selisih" menampilkan
  Rp 1 pada baris yang tidak pernah disentuh siapa pun; `fullCalcOnLoad` tidak
  dipasang di template (di CCO dipasang), jadi angka yang terlihat bergantung
  pada pembacanya.
- 🟡 **Impor Excel ke draft memintas SEMUA pagar realisasi editor.** Peringatan
  disusun lalu commit dilanjutkan tanpa syarat, jadi pagar di `lib/rab/adendum.ts`
  bukan invarian sistem melainkan aturan satu layar. Mungkin disengaja
  (DECISIONS 203), tapi konsekuensinya: lineage yang hilang membuat realisasinya
  lenyap dari angka resmi. Sejak 742: draft pengganti yang volumenya di bawah yang
  dilaporkan disebut di layar impor, dan baris laporan draft tanpa padanan ditolak;
  item KONTRAK ber-realisasi yang hilang dari berkas tetap ter-commit (hanya peringatan
  pratinjau).
### Siklus hidup & konkurensi

- 🟡 **Tanda tangan menempel pada JAM, bukan pada ISI.** Gugurnya suara semata
  perbandingan `approvedAt >= updatedAt`. `renameRabCategoryAction` mengganti
  nama kategori revisi MANA PUN — termasuk draft yang sudah ditandatangani dan
  revisi yang sudah AKTIF — tanpa penjagaan status dan tanpa menyentuh revisi.
  `RabRevisionApproval.totalValue`, yang schema-nya sendiri menyebut "untuk
  jejak menyetujui angka yang mana", ditulis dan tidak pernah dibaca. Yang benar
  adalah mengikat persetujuan pada hash isi draft.
  *Dugaan, belum diverifikasi (butuh DB)*: `approved_at` ber-`DEFAULT now()`
  (jam server DB) diadu dengan `updatedAt` dari `@updatedAt` (jam proses
  aplikasi) — dua sumber jam berbeda, dan uji unit menetapkan "sama persis =
  sah". Skew beberapa detik ke arah DB membuat suara bertahan melewati suntingan.
- 🟡 **TOCTOU aktivasi.** `pastikanBolehAktivasi` dan `activateRevision` dua
  transaksi terpisah tanpa `FOR UPDATE` dan tanpa kolom versi, dan aktivasi tidak
  mengulang pemeriksaan persetujuan di dalam transaksinya. Dua jendela: suntingan
  menyelinap SEBELUM aktivasi (yang diaktifkan tidak ditandatangani), dan
  suntingan menyelinap SESUDAH (mendarat pada revisi yang sudah jadi RAB aktif,
  lalu `recomputeTotals` menulis `totalValue` baru ke revisi aktif). Aktivasi
  ganda sendiri sudah tertutup rapat oleh partial unique index.
- 🟢 **Tidak ada indeks unik "satu draft per lokasi".** `createAdendumDraft`
  hanya `findFirst` di dalam transaksi tanpa kunci, jadi dua draft bisa lahir
  bersamaan dan tanda tangan bisa menempel di draft yang tidak ditampilkan.
- 🟢 **Status revisi RAB di luar mesin transisi.** `RevisionStatus` tidak ada di
  `lifecycle.ts` dan tidak punya tabel histori (melanggar prinsip WAJIB #5).
  Mitigasinya nyata (transaksi atomik, unique index, audit, `supersededAt`), tapi
  audit atas `digantikan` tidak menyebutkan revisi mana yang digantikan.
- 🟢 **Fallback PPN 11% yang mengarang.** `cco/route.ts` memakai `: 11` saat
  kontrak belum ada, lalu mencetaknya sebagai fakta ("termasuk PPN 11%") di
  berkas yang dikirim ke KKP. Lebih baik menolak mencetak daripada menebak.

### Uji yang hilang

- 🟡 **Round-trip tidak menutup jalur adendum.** `rab-ekspor-impor-ulang.test.ts`
  seluruhnya `buildRabXlsx` → `parseHpsWorkbook`. Tidak ada uji untuk
  `buildCcoXlsx` → `deteksiCco`, sel teks, sel galat, formula tanpa cache, header
  `SATUAN`, atau volume negatif. `cco-import.test.ts` membangun sheet sintetis
  yang selalu berisi angka literal konsisten — persis kondisi yang TIDAK pernah
  terjadi pada berkas terbitan MARLIN sendiri. Sebagian sudah: `cco-putar-balik.test.ts`
  (`buildCcoXlsx` → `deteksiCco`, rumus ber-cache) dan `angka-lokal.test.ts` (sel teks,
  galat, tanpa cache). Belum: round-trip CCO untuk sel teks/galat, header `SATUAN`, dan
  volume negatif.
- 🟡 **Tidak ada uji lintas-lokasi pada jalur persetujuan.** Yang baru ditutup
  adalah editor draft; `approveRevisionAction` dan `activateDraftAction`
  menyelesaikan lokasi dari `revisionId` sehingga kebal, tapi itu belum dikunci
  uji.

## 🟡 Berkas pindahan tidak bisa dibuka selama arsip Lenovo mati (DECISIONS 676)

Berkas yang sudah dipindah ke Lenovo dan salinan R2-nya dibuang hanya bisa dibaca
dari Lenovo. Kalau Lenovo mati, dokumen/surat/foto lama menjawab 503 ("arsip Lenovo
sedang tidak bisa dihubungi") sampai Lenovo hidup lagi. Cadangan Drive
(DECISIONS 650) sudah memegang salinannya, tapi belum dipakai sebagai jalur baca
cadangan di `src/lib/penyimpanan/berkas.ts`.
