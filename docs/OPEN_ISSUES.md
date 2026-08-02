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
- 🟡 **CategoryPhase/TRADES hardcoded** di `src/lib/scurve/generate.ts` (keyword→window).
  Kandidat: tabel konfigurasi effective-dated.
- 🟢 Province/Regency masih string bebas (belum reference table BPS).

## Security

- 🟡 **RLS belum diimplementasi** (dan TIDAK diklaim). Otorisasi di application layer
  (capability + scope), diuji test. RLS = hardening tahap berikut.
- 🟡 Rate limit hanya untuk login; server action lain belum di-rate-limit.
- 🟢 CSP/security headers belum diset di next.config.

## Fitur ditunda sadar (lihat docs/rebuild/REBUILD_PLAN.md)

- 🟡 **PWA offline penuh** — sekarang: draft lokal (localStorage) + submit idempotent;
  belum ada service worker/manifest installable/background sync.
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

- 🟡 **ESLint ditahan 9.39.5** — eslint-config-next 16 (eslint-plugin-react) belum
  kompatibel ESLint 10. Re-evaluasi tiap rilis Next.
- 🟡 **TypeScript ditahan 5.9.3** — TS 7 (native) belum diverifikasi dengan plugin Next.
- 🟡 `pnpm audit`: 3 moderate di transitive dev deps (tidak high/critical; CI gate high).
- 🟢 `exceljs` maintenance lambat; buffers@0.1.1 transitive tanpa metadata lisensi
  (pengecualian terdokumentasi di OPEN_SOURCE_LICENSE_AUDIT.md).
- 🟢 Foto stamp memakai font DejaVu bundel; verifikasi otomatis foto (flag GPS/waktu)
  belum dievaluasi rutin (dedup sha256 jalan).

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
  COUNTED_REPORT_STATUSES = [dikirim, disetujui, final] — SATU level, dipakai
  dashboard, blanko KKP, kurva-S, keuangan (installedValue), dan AI. UI
  melabelinya "Realisasi" di ±12 tempat.
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
