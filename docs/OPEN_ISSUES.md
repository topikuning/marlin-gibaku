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

## Security

- 🟡 **RLS belum diimplementasi** (dan TIDAK diklaim). Otorisasi di application layer
  (capability + scope), diuji test. RLS = hardening tahap berikut.
- 🟡 Rate limit hanya untuk login; server action lain belum di-rate-limit.
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
- 🟢 Intake WA-text mandor (model lama SuggestionSource tidak dibawa).
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

- 🟡 **AI-01 (sisa) · Grok/xAI belum bisa menerima PDF dari MARLIN.** Jalur PDF
  OpenAI (`type:"file"`) dan Mistral (`type:"document_url"`) sudah dibangun dan
  diuji bentuk medannya (DECISIONS 435). xAI belum: PDF di sana tidak bisa
  disisipkan langsung di pesan – harus diunggah dulu lewat Files API lalu
  dirujuk `attachments:[{file_id}]`, alur dua langkah yang perlu penyimpanan
  file_id + pembersihannya. Sampai itu dibangun, teks layar berbunyi "MARLIN
  belum bisa", BUKAN "Grok tidak bisa".
- 🟢 **Ringkasan lokasi: dua keluhan konsol React (bukan penghalang).** Terlihat
  saat memverifikasi DECISIONS 436 di peramban, TIDAK berkaitan dengan surat:
  (a) `PelaksanaForm` hidrasi tidak cocok – `encType` server `null` vs klien
  `multipart/form-data`; (b) `scurve-chart` mengirim `cy=NaN` saat seri
  realisasi kosong. Keduanya kosmetik hari ini, tapi (b) berarti ada titik yang
  digambar dari nilai yang tidak ada.
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
- 🟡 `pnpm audit`: 3 moderate di transitive dev deps (tidak high/critical; CI gate high).
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
Termin 20/25/30/25 ditagih saat progres TOTAL kontrak mencapai 25/50/80/100%, dengan
retensi pemeliharaan 5% (bisa diganti jaminan pemeliharaan). Perlu: modul keuangan
otomatis menandai "termin-N siap ditagih" saat progres agregat lewat ambang, +
perhitungan retensi & opsi jaminan pemeliharaan. Milestone pembayaran sudah scope induk.

## FUTURE · AI Hub — pekerjaan lanjutan yang sengaja ditunda (DECISIONS 133)
- E2E Playwright alur AI (PM buka hub → pulse → variance → report lifecycle →
  distribusi → Ask) belum ditulis — unit (34) + integration hijau.
- Rule readiness/quality tambahan: dokumen WAJIB per fase (butuh definisi daftar
  wajib), kandidat foto near-duplicate (butuh perceptual hash — byte-identik
  sudah dicegah sha256), spike volume harian abnormal.
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
- Kurva-S PAKET pada slide progres masih visual rencana-vs-realisasi sederhana;
  seri kurva-S agregat paket butuh builder calculation-layer sendiri.

## FUTURE · Chat grup & kop surat — lanjutan (DECISIONS 135)
- Penjadwalan OTOMATIS ringkasan harian chat grup (tiap pagi utk H-1) — butuh
  scheduler; opsi: Railway cron job memanggil route internal. Perlu keputusan.
- Sinkronisasi ringkasan chat ke laporan: tampilkan di workspace lokasi/paket,
  ikut sebagai konteks exec-report & AI Hub (sumber "chat_grup" + sourceRef).
- Wiring kop surat + logo perusahaan ke header dokumen cetak /cetak/* (KKP,
  laporan periodik, laporan AI).

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
di-drill-down. Saat ini hanya AI Hub Pulse yang punya `dataAsOf`.

Wujud konkretnya di `getLocationProgress`: realisasi dihitung untuk SELURUH
waktu sementara `planPct` memakai minggu berjalan menurut jam dinding. Untuk
"hari ini" angkanya benar; yang tidak bisa dijawab adalah **"berapa angkanya
per 30 Juni?"**. Laporan periodik tidak punya masalah ini — ia memakai batas
periode eksplisit dan sudah diuji stabil terhadap "hari ini" (*Date-as-of
gate*). Jadi ini soal ketertelusuran, bukan kebenaran angka.

Opsi: (a) tambah parameter `asOf` pada `getLocationProgress`; (b) cukup beri
label "s.d. hari ini" pada setiap KPI dashboard; (c) presentation contract
berlabel penuh lintas modul. Perlu keputusan — (a) dan (c) refactor besar,
(b) murah dan sudah menghilangkan salah tafsir.

## 🟢 Jadwal asumsi (SPMK belum terbit) tidak ditandai di output (audit M9)

`getPeriodBounds(locationId, { assume: true })` mengasumsikan kontrak mulai HARI
INI ketika SPMK belum ada, supaya kurva-S rencana tetap bisa dilihat. Flag
`assumed` ADA di `PeriodBounds` tetapi tidak diteruskan ke `PeriodReport`,
sehingga halaman Cetak Jadwal / Unduh Excel tidak memberi tanda bahwa tanggalnya
karangan. Laporan periodik resmi tidak terpengaruh (dipanggil tanpa `assume`).

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
renderer, tidak ada yang menangkapnya.

## Audit total 2026-07-27 — sisa yang sengaja di-defer (P0 di DECISIONS 154, P1/P2 di DECISIONS 155)

Semua temuan B1–B19 sudah dikerjakan (lihat DECISIONS 154–155). Yang tersisa
adalah defer eksplisit + item yang butuh keputusan:

- 🟡 **UI — migrasi primitif Modal/Drawer penuh**: 4 dialog/drawer ad-hoc sudah
  dapat Escape + focus-restore (`useDismissable`, `ConfirmSubmit`), tetapi belum
  jadi satu primitif Modal/Drawer bersama (focus trap penuh + inert background).
- 🟢 **UI — token tipografi**: skala font de-facto (10/11/12/13px, 262 kemunculan
  `text-[Npx]`) belum diangkat jadi token; sensus 53 tombol mentah belum
  dimigrasi semua ke `Button` (yang paling terlihat sudah: masuk, ganti-password,
  foto).
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

## WAHA — pemeriksaan sesi baru dipasang di jalur pengingat harian

- 🟡 **`sendImage` & pemakaian WAHA lain belum memeriksa status sesi.**
  DECISIONS 206 memasang `getSessionStatus() === "WORKING"` sebagai syarat di
  `kirimPengingatHarian` saja, karena itu jalur yang dilaporkan user gagal
  senyap ("terkirim 7", nol sampai). Jalur lain (mis. kirim foto/laporan ke
  grup WA) masih menganggap "2xx = terkirim", jadi bisa mengulangi kegagalan
  yang sama. Perlu disisir jadi satu pembungkus kirim yang selalu memeriksa
  sesi + menyimpan `waMessageId`.
- 🟡 **Penyebab "terkirim 7, nol sampai" belum dipastikan.** DECISIONS 207
  memperbaiki dua hal yang bisa menyebabkannya (nomor tak dinormalkan saat
  kirim; "sukses" tanpa bukti ID pesan) dan membuat hasilnya bisa dibaca per
  orang, tetapi mana yang sebenarnya terjadi di produksi belum terbukti — butuh
  satu pengiriman nyata setelah rilis ini untuk melihat rinciannya.

## RAB — angka berkas ekspor tidak sama dengan angka di layar

- 🔴 **Selisih Rp 3.705 antara ekspor Sugihwaras dan tampilan RAB aktif.**
  Berkas ekspor (revisi aktif #1) konsisten ke dalam: Σ kategori = JUMLAH =
  Σ daun tiap kategori = **5.891.116.482**. Layar menunjukkan
  **5.891.112.777**. Selisihnya tersebar di 8 dari 17 kategori, mis.:

  | Kategori | Ekspor | Layar | Selisih |
  |---|---:|---:|---:|
  | I PEKERJAAN PERSIAPAN | 454.354.160 | 454.354.154 | +6 |
  | V PEKERJAAN BANGUNAN SHELTER | 289.501.021 | 289.501.026 | −5 |
  | VI PONDASI GUDANG BEKU | 302.657.239 | 302.657.158 | +81 |
  | IX BANGUNAN KIOS PERBEKALAN | 172.985.194 | 172.982.810 | +2.384 |
  | XI TANGKI AIR & SUMUR BOR | 493.031.923 | 493.032.035 | −112 |
  | XIII BANGUNAN GENSET | 237.194.847 | 237.192.920 | +1.927 |
  | XIV JALAN LINGKUNGAN & SALURAN | 607.649.275 | 607.648.828 | +447 |
  | XVII BANGUNAN DOCKING KAPAL | 405.673.573 | 405.674.596 | −1.023 |

  Selisihnya dua arah, jadi bukan sekadar pembulatan satu sisi. Penyebabnya
  belum diketahui: bisa berarti berkas diekspor dari revisi yang berbeda dengan
  yang kini tampil, bisa juga agregat layar dan agregat tersimpan memang
  dihitung dari sumber yang berbeda. TIDAK diperbaiki dengan tebakan — perlu
  dipastikan dulu revisi mana yang diekspor (DECISIONS 208, dan protokol di
  `docs/rebuild/CALCULATION_INTEGRITY_PROTOCOL.md`).

## 🟢 WA-01 · Error 463 tidak bisa diakali dari aplikasi (DECISIONS 222 → 374/380)

Log server user 2026-08-02:

```
error 463: account restricted or missing tctoken for contact
msgId: 3EB052C20C9F6C2394177D  from: 6287776689958@s.whatsapp.net  engine: NOWEB
```

WAHA menerbitkan `msgId`, MARLIN mencatatnya sebagai bukti, halaman menyatakan
berhasil — lalu mesin WAHA menolak sendiri karena WhatsApp membatasi nomor
pengirim menghubungi nomor BARU. Penolakannya terjadi SESUDAH id terbit dan
tidak terlihat dari respons API.

**Sisi perangkat lunak SUDAH selesai.** DECISIONS 374 memasang outbox
(`wa_outbound`) + rekonsiliasi `message.ack`, sehingga nasib tiap kiriman
tercatat dan bisa naik (`terkirim`→`sampai`→`dibaca`) atau berakhir
`gagal`/`ditolak`. DECISIONS 380 menyambungkannya ke layar pengingat harian:
`DailyReminderLog` dicocokkan ke outbox lewat **ID pesan**, jadi pengingat yang
ditolak WhatsApp tidak lagi tampil "ada ID pesan".

**Yang tersisa BUKAN bug kode**: error 463 tidak bisa diakali dari aplikasi.
Yang menyelesaikannya di sisi WhatsApp — nomor pengirim yang sudah "hangat"
(dipakai wajar, punya riwayat percakapan dua arah), atau penerima
menyimpan/menghubungi nomor itu lebih dulu.

**Syarat operasional**: event `message.ack` harus diaktifkan di WAHA untuk URL
webhook yang sama. Tanpa itu status berhenti di `Diterima WAHA` selamanya — dan
itu jujur: memang tidak ada bukti lain yang pernah tiba.

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

## 🟡 TTD-01 · Gambar tanda tangan ditempel tanpa memeriksa status dokumen (DECISIONS 328)

`muatTtdLaporan` / `muatTtdPdf` menempelkan gambar pada SETIAP dokumen yang
dicetak, termasuk pratinjau laporan harian yang **belum difinalisasi** (halaman
cetak harian sudah menandainya dengan spanduk "Pratinjau", tapi tanda tangannya
tetap tercetak).

Yang seharusnya: pemanggil memutuskan, dan dokumen yang belum berstatus final /
disetujui keluar dengan ruang kosong. Komponen penempelnya sudah dirancang untuk
itu — ia hanya menggambar apa yang diberikan — jadi perbaikannya ada di sisi
pemanggil, bukan di komponen.

Belum dikerjakan karena aturannya berbeda per dokumen (harian punya
`isFinal`; rencana mingguan & periodik tidak punya padanannya yang setara) dan
itu keputusan user, bukan tebakan.

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

**Belum**: uji `PAKSA mengirim ulang di hari yang sama` masih menghitung jumlah
pesan terkirim secara global, jadi lokasi sisa run sebelumnya membuatnya
mengharapkan 2 tapi menerima 7. Perbaikannya sejenis — saring ke fixture-nya
sendiri — tapi menyentuh uji yang tidak berhubungan dengan pekerjaan berjalan,
jadi dikerjakan terpisah.

Dalam rangkaian penuh `pnpm vitest run tests/integration` semuanya hijau
(berkas lain mem-`TRUNCATE` lebih dulu). Gejalanya hanya muncul saat berkas itu
dijalankan sendirian berulang kali.

## 🟡 UI-04 · `border-border-muted` tidak pernah ada — 9 berkas memakai kelas mati

Ditemukan 2026-08-20 saat menambah papan kendala.

`--color-border-muted` **tidak pernah didefinisikan** di `src/app/globals.css`,
tapi `border-border-muted` dipakai di 9 berkas komponen. Tailwind 4 membangun
kelas dari token yang ada; token yang tidak ada tidak menghasilkan aturan CSS
apa pun. Jadi elemen-elemen itu tampil **tanpa garis batas sama sekali**, bukan
dengan garis yang lebih samar seperti yang jelas dimaksudkan penulisnya.

Tidak merusak fungsi, dan tidak diperbaiki sekalian karena dua kemungkinan
perbaikannya berbeda hasil: mendefinisikan tokennya (9 tempat itu mendadak
bergaris) atau mengganti ke `border-border` yang ada (garisnya lebih tegas
daripada niat aslinya). Mana yang benar keputusan tampilan, bukan keputusan
kode.

Ditemukan dengan `grep -c "color-border-muted" src/app/globals.css` → 0.

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
- 🟢 **Ambang termin dari kontrak** — ambang 25/50/80/100 kini konstanta
  (`lib/kesiapan/rules.ts`, DECISIONS 078). Kalau ada paket bertermin lain,
  angkanya harus pindah ke data kontrak.
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
- 🟢 **`simpanHargaAction` (jalur FormData) tidak dipakai satu pun layar.**
  Grid memakai `simpanHargaSel`. Ia sudah ikut diperketat (asal-usul harga
  ditetapkan server), tetapi kode yang tidak dipanggil siapa pun sebaiknya
  dibuang — ditunda supaya diff RAPL-01…08 tetap bisa dibaca.
- 🟡 **Kotak centang grid bisa tetap tercentang setelah aksi borongan.**
  Sesudah `putuskan()` berhasil, `harga-panel.tsx` mengosongkan hitungannya
  sendiri (`setDicentang([])`), tetapi tidak ada yang memanggil API seleksi AG
  Grid. `MarlinGrid` menyimpan `apiRef` secara privat dan tidak menyediakan
  jalan keluar imperatif, jadi pemanggil tidak punya cara meminta
  `deselectAll()`. Bila AG Grid tidak melepas sendiri baris yang jadi tidak
  terpilih sesudah data disegarkan, layar memperlihatkan baris tercentang
  sementara tombolnya menulis "0 dicentang" dan mati. Belum terbukti terjadi —
  karena itu ditulis di sini, bukan ditambal dengan tebakan. Perbaikannya
  bersifat lintas-komponen (`forwardRef` pada `MarlinGrid`), menyentuh juga
  `padanan-panel.tsx` yang berbentuk sama.
- 🟢 **Jajak pendapat draf AI menarik ulang SELURUH halaman tiap 3 detik.**
  `harga-panel.tsx` memanggil `router.refresh()` tiap 3 detik selama draf
  berjalan, dan itu menjalankan ulang keenam kueri `RaplPage` (termasuk
  `simulasiRapl` atas ratusan baris) hanya untuk membaca satu boolean. Ini
  konsekuensi sadar dari pola DECISIONS 455 — menunggu di layar, bukan di
  dalam request — dan dicatat sebagai ONGKOS, bukan cacat: endpoint status
  tersendiri akan menghapusnya kalau ternyata terasa.
