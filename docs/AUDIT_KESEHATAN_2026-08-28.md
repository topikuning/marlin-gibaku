# AUDIT KESEHATAN REPO MARLIN — 2026-08-28

> Audit read-only menyeluruh: struktur, cakupan pengujian, kepatuhan kalkulasi,
> penegakan otorisasi & jejak audit, keamanan, skema data, kinerja, dan
> dependency. Tidak ada kode yang diubah.

**Basis**: branch `dev`, commit `966922b` · **Run CI acuan**: `33136837467` (main, hijau)

## Label sumber klaim

- **[JALAN]** — perintah dijalankan auditor di mesin ini, hasilnya di bawah.
- **[CI]** — dari GitHub Actions yang benar-benar berjalan.
- **[dibaca]** — disimpulkan dari membaca kode. Tidak dieksekusi.
- **[hitung]** — turunan aritmetik manual dari kode, belum dijalankan sebagai uji.

### Yang benar-benar dijalankan [JALAN]

| Perintah | Hasil |
|---|---|
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** |
| `pnpm vitest run tests/unit` | **exit 0 — 194 berkas, 2.415 uji, semua lulus, 50,4 s** |

### Yang tetap tidak bisa dijalankan

`docker info` dan koneksi Postgres lokal keduanya gagal di mesin ini, jadi 82
berkas uji integrasi dan 33 spec E2E **tidak** dijalankan auditor. Klaim hijau
untuk keduanya berasal dari CI.

Catatan sampingan [JALAN]: pnpm memperingatkan `Unsupported engine: wanted
{"node":">=24.0.0 <25"} (current: v22.23.2)`. Uji tetap lulus, tetapi mesin
lokal ini tidak menjalankan versi Node yang dipakai Dockerfile dan CI.

---

## Ringkasan eksekutif

Repo ini **sehat, dan lebih disiplin dari kebanyakan repo seukurannya**.
Penegakan otorisasi rapat, invarian ditegakkan di DB, tidak ada rahasia
terkomit, tidak ada celah injeksi SQL, dan tiga gerbang mutu lokal hijau
seluruhnya.

Kelemahannya tidak tersebar — ia terpusat pada tiga sumbu:

1. **Definisi "layer kalkulasi kanonik" tidak tunggal** (tiga dokumen, tiga
   daftar), sehingga aturan anti-duplikasi tidak bisa ditegakkan konsisten.
2. **Uang paling lemah penjagaan ujinya** — modul kanonik keuangan tidak punya
   satu pun uji, dan sebagian agregasinya hidup di komponen halaman.
3. **Jejak & pembersihan pada penghapusan tidak seragam** — sebagian
   penghapusan tak beraudit, dan berkas asli foto tertinggal di R2.

| Prioritas | Jumlah |
|---|---|
| 🔴 Critical | 5 |
| 🟡 Important | 8 |
| 🟢 Nice-to-have | 6 |

---

## STATUS PERBAIKAN (diperbarui 2026-08-28, DECISIONS 461)

Seluruh temuan sudah ditangani kecuali empat yang sengaja tidak dikerjakan,
alasannya di bawah. Gerbang lokal sesudah perbaikan: `pnpm typecheck` **exit 0**,
`pnpm lint` **exit 0**, `pnpm vitest run tests/unit` **195 berkas / 2.434 uji
lulus** (sebelumnya 194 / 2.415).

| # | Status | Perbaikan |
|---|---|---|
| C-1 | ✅ | Daftar kanonik disatukan jadi LIMA berkas di `PROJECT.md` §3; `CLAUDE.md` butir 7 + protokol kini merujuk, tidak menyalin |
| C-2 | ✅ | Rujukan `DATA_MODEL_AUDIT.md` diganti `PROJECT.md` §3 + `DECISIONS.md`, dengan peringatan ARSIP |
| C-3 | ✅ | `tests/unit/finance-calc.test.ts` — 19 uji atas `unbilledWork`, `cashRequirement`, `alokasiBelumTertagih`, `totalPortofolio` |
| C-4 | ✅ | Σ + alokasi proporsional pindah ke `finance/calc.ts`; halaman Keuangan tinggal memanggil |
| C-5 | ✅ | `buatSurat` pindah ke `src/lib/surat/buat.ts` (modul biasa); dua pemanggil + satu uji integrasi diarahkan ulang |
| I-1 | ✅ | `bobotToday` diturunkan dari volume × `amount` revisi aktif, bukan `valueDone` |
| I-2 | ✅ | Dua salinan `bobotPct` diganti panggilan kanonik |
| I-3 | ✅ | `realisasiKategoriPct()` diangkat ke `progress-calc.ts`; `paparan/snapshot.ts` memanggilnya |
| I-4 | ✅ | `audit()` ditambahkan pada dua aksi hapus foto/lampiran kegiatan |
| I-5 | ✅ | `originalKey` ikut dibersihkan di dua jalur hapus `field-activity` |
| I-6 | ⚠️ sebagian | Seed kini punya satu paket berselisih 2%; `paket-drawer.spec.ts` skip → gagal tegas. `konfirmasi.spec.ts` **dibiarkan** |
| I-7 | ✅ | `paparan/snapshot.ts` memakai `volumeDalamRentangByLineage` + query batch (helper `…Multi` dibuang DECISIONS 460) |
| I-8 | — | Historis; `main` sudah hijau. Tidak ada yang bisa diperbaiki |
| G-1 | ❌ sengaja | Presentation contract penuh = perubahan desain lintas seluruh angka, menunggu keputusan user (protokol sendiri menyatakannya) |
| G-2 | ✅ | Enam dokumen + laporan ini masuk peta `docs/README.md` |
| G-3 | ❌ sengaja | Pemecahan berkas >1.000 baris: restrukturisasi besar tanpa cacat terbukti |
| G-4 | ✅ | `@types/pdfkit` dipin eksak |
| G-5 | ❌ | Node lokal v22 vs pin 24 — urusan mesin pengembang, bukan isi repo |
| G-6 | ❌ | E2E lambat & flaky: butuh menjalankan E2E untuk diagnosis; tidak bisa di mesin ini |

**I-6 sebagian, alasannya**: `konfirmasi.spec.ts:39` melewat bila hari itu tidak
ada penanggung jawab yang perlu ditagih. Preconditionnya tidak bisa dipastikan
deterministik tanpa menjalankan aplikasi + DB, dan **CI merah palsu lebih buruk
daripada skip yang jujur**. Dibiarkan apa adanya, bukan dipaksa hijau.

**Yang belum diverifikasi eksekusi**: perubahan I-1 menyentuh
`tests/integration/ringkas-harian.test.ts:271` (mengharap `bobotToday ≈ 16`) dan
I-7 menyentuh `tests/integration/paparan-snapshot.test.ts`. Keduanya uji
integrasi — **tidak dijalankan di mesin ini** (tanpa Postgres/Docker). Bila
harga satuan pada fixture-nya sama dengan revisi aktif, angkanya tidak berubah;
CI yang akan membuktikan.

---

### Angka dasar

| Ukuran | Nilai |
|---|---|
| Berkas sumber (`src`, tanpa `src/generated`) | 661 berkas · 146.005 baris |
| Uji unit / integrasi / E2E | 194 / 82 / 33 berkas · **2.415 uji unit lulus** |
| Berkas `"use server"` sejati | 41 |
| Aksi server terekspor · yang memutasi data | 244 · 102 |
| `requireCapability` · `requireLocationAccess` · `audit`/`auditIn` | 211 · 100 · 242 |
| Migrasi Prisma · baris schema · `@@index` · `@@unique` | 84 · 3.060 · 121 · 33 |
| Dependency dipin eksak | 40 dari 41 |

---

# 🔴 CRITICAL

## C-1 — Daftar "calculation layer kanonik" berbeda di tiga dokumen

**Bukti** [dibaca]:

| Dokumen | Berkas yang disebut kanonik |
|---|---|
| `CLAUDE.md` butir 7 | `progress-calc.ts` · `progress.ts` · `finance/calc.ts` · **`ahsp/rapl-calc.ts`** |
| `PROJECT.md` §3 | `progress-calc.ts` · `progress.ts` · `finance/calc.ts` · **`plan/rencana-format.ts`** |
| `CALCULATION_INTEGRITY_PROTOCOL.md` | `progress-calc.ts` · `progress.ts` saja |

Gabungannya **lima** berkas; tidak satu dokumen pun memuat kelimanya.
`plan/rencana-format.ts` (175 baris, formula PPC & proyeksi) dan
`ahsp/rapl-calc.ts` (402 baris, biaya RAPL) sama-sama nyata ada.

**Dampak.** `CLAUDE.md` butir 2 menetapkan `PROJECT.md` sebagai source of truth.
Diterapkan harfiah, `ahsp/rapl-calc.ts` **bukan** layer kanonik — padahal
`CLAUDE.md` butir 7 mewajibkannya. Sebaliknya `plan/rencana-format.ts` tidak
terlindungi larangan duplikasi. Gerbang source-of-truth tak bisa ditegakkan
selama daftarnya sendiri bercabang.

**Rekomendasi.** Satukan di `PROJECT.md` (lima berkas), rujuk dari dua dokumen
lain alih-alih menyalin. Penjaganya sudah ada polanya:
`tests/unit/permission-matrix-doc.test.ts`.

**KEPUTUSAN**: apakah `plan/rencana-format.ts` dan `ahsp/rapl-calc.ts` kanonik penuh?

## C-2 — Protokol wajib menunjuk dokumen ARSIP sebagai bacaan wajib

**Bukti** [dibaca]: `CALCULATION_INTEGRITY_PROTOCOL.md:26` mencantumkan
`docs/rebuild/DATA_MODEL_AUDIT.md` sebagai "File wajib dibaca sebelum coding".
Berkas itu dibuka dengan bannernya sendiri:

> **ARSIP — schema & formula sistem LAMA (b6e77af).** Bukan spesifikasi berjalan.

`docs/README.md:43` juga menggolongkannya ARSIP: **"jangan dipakai sebagai acuan
implementasi"**.

**Dampak.** Siapa pun yang patuh pada protokol diarahkan membaca formula
**pra-rebuild** sebelum menyentuh angka — persis mode kegagalan yang protokol
itu peringatkan di pembukaannya sendiri.

## C-3 — `finance/calc.ts` adalah modul kanonik tanpa satu pun uji

**Bukti** [dibaca]: tidak ada berkas di `tests/` yang mengimpor
`@/lib/finance/calc`. Pemakainya hanya kode produksi (`keuangan/page.tsx:9`,
`ai-hub/adapters.ts:4`, `finance/queries.ts:3`). Dua fungsi murni di dalamnya
tidak diuji: `unbilledWork()` (`calc.ts:156`) dan `cashRequirement()` (`:162`).
`tests/integration/finance-race.test.ts` menguji perlombaan transaksi, bukan formula.

| Modul kanonik | Berkas uji yang mengimpor |
|---|---:|
| `progress.ts` | 10 |
| `periodic-report.ts` | 9 |
| `progress-calc.ts` | 5 |
| `ahsp/rapl-calc.ts` | 2 |
| `plan/rencana-format.ts` | 1 |
| **`finance/calc.ts`** | **0** |

**Dampak.** Uang adalah satu-satunya angka yang salahnya tidak bisa
dinegosiasikan, dan justru itu yang tak berpenjaga. PPN masuk lewat
`ppnPercent` di `unbilledWork` — jalur yang persis diperingatkan gerbang
"RAB pre-PPN vs kontrak incl-PPN".

**Rekomendasi.** Fixture emas: PPN 0%, PPN 11%, `billed` melebihi terpasang,
`installedReportedPreTax = 0`, pembulatan setengah-naik untuk nilai negatif.

## C-4 — Agregasi uang hidup di dalam page component

**Bukti** [dibaca]: `src/app/(app)/keuangan/page.tsx:42–81` menjumlahkan nilai
terpasang lintas lokasi dan mengalokasikan "belum tertagih" secara proporsional
untuk kontrak multi-lokasi, ditambah enam agregat portofolio (baris 69–81).
Melanggar `CLAUDE.md` butir 7 dan gerbang source-of-truth ("dashboard agregasi
sendiri").

**Sudah disadari dan sengaja dibiarkan** — `src/lib/ai-hub/adapters.ts:62–73`
menolak menyuplai angka itu ke AI justru karena alasan ini:

> penjumlahan itu hari ini hidup di dalam halaman Keuangan … Menyalinnya ke sini
> akan melahirkan IMPLEMENTASI KEDUA dari satu formula uang.

Penalarannya benar dan disiplinnya patut dicatat — akibatnya satu angka uang
resmi hanya bisa dilihat di layar Keuangan, **tidak bisa dipakai AI, PDF, atau
Excel** tanpa menduplikasi formula. Utang teknisnya membayar bunga.

## C-5 — `buatSurat` terekspor dari modul `"use server"` tanpa penjaga di dalamnya

**Bukti** [dibaca]: `src/lib/surat/lampiran-actions.ts:1` adalah `"use server"`.
Di baris 283:

```ts
export async function buatSurat(input: {
  orgId: string;
  createdById: string;      // ← identitas datang dari argumen, bukan sesi
  packageId: string | null;
  ...
}): Promise<{ id: string; agendaNo: number; agendaYear: number }>
```

Fungsi ini **memutasi** (`db.$transaction`, membuat baris `Letter` + nomor
agenda) dan tidak memanggil `requireCapability`, `requireLocationAccess`,
maupun `audit` di dalam dirinya. Penjaganya ada di dua pemanggilnya
(`lampiran-actions.ts:241`, `surat/actions.ts:121`).

**Dampak.** Di Next.js App Router, **setiap fungsi yang diekspor dari modul
`"use server"` menjadi endpoint yang bisa dipanggil klien**, bukan hanya yang
dipakai komponen. Karena `orgId` dan `createdById` diambil dari argumen,
pemanggilan langsung berarti surat bisa dicatat di register resmi atas nama
**user lain**, di **organisasi lain**, tanpa jejak audit.

**Kejujuran soal keterpakaian**: eksploitasinya menuntut penyerang mengetahui
action ID fungsi ini, dan ID itu hanya muncul di bundel klien untuk aksi yang
memang dirujuk komponen — `buatSurat` tampaknya hanya dipanggil dari server.
Jadi ini **permukaan serangan, belum tentu lubang yang sudah menganga**.
Panduan Next.js tetap tegas: perlakukan tiap ekspor modul `"use server"`
sebagai endpoint publik.

**Rekomendasi — polanya sudah ada di repo ini.**
`src/lib/kendala/naikkan.ts:9` menyelesaikan persoalan yang sama persis dengan
sengaja **tidak** menjadi modul `"use server"`:

> Dipanggil dari server action finalisasi kegiatan – bukan modul "use server"
> sendiri supaya bisa dipanggil sebagai fungsi biasa, dan supaya penjaganya
> (capability + akses lokasi) tetap satu tempat di pemanggil.

Pindahkan `buatSurat` ke modul biasa (mis. `src/lib/surat/buat.ts`), atau
tambahkan `requireCapability` + `audit` di dalamnya dan ambil `createdById` dari
sesi, bukan dari argumen.

---

# 🟡 IMPORTANT

## I-1 — Bobot harian dihitung dari `valueDone`, basis yang dilarang

**Bukti** [dibaca]: `src/lib/daily-report/ringkas.ts:282`

```ts
// Formula bobot dari progress-calc — tidak dihitung ulang di sini.
bobotToday: bobotPct(Number(i.valueDone), Number(grandTotal)),
```

Fungsinya kanonik, tetapi **pembilangnya salah basis**. Protokol menyatakan
`valueDone` "**bukan basis agregat mana pun**"; alasannya tercetak di
`progress-calc.ts:67` — `valueDone` dibekukan memakai harga satuan revisi yang
aktif saat laporan dibuat. Angka ini terbit di PDF harian
(`src/lib/pdf/harian-ringkas.ts:696`).

**Proof [hitung]** — belum dieksekusi sebagai uji:

| Case | Input | Formula manual | Expected | Actual | Selisih |
|---|---|---|---:|---:|---|
| Adendum menaikkan harga setelah laporan dibuat | 1 item, volK 100, harga awal Rp1.000.000 ⇒ amount Rp100 jt. Laporan volumeDone 10 ⇒ `valueDone` beku Rp10.000.000. Adendum ⇒ harga Rp1.200.000, grandTotal Rp120 jt | kanonik (10/100)×100% = **10,00%** · aktual 10jt/120jt×100 = **8,33%** | 10,00% | 8,33% | **−1,67 pp** |

Tanpa adendum keduanya identik — itulah sebabnya cacat ini tak pernah terlihat.

Catatan kedua, **belum terverifikasi**: jalur `valueDone` tidak melewati batas
100% milik `prestasiPct`. Apakah laporan melebihi volume kontrak bisa mencapai
jalur ini bergantung pada penolakan `over_volume` di
`daily-report/recap-parse.ts:215` — tidak saya telusuri tuntas.

## I-2 — Formula `bobotPct` diketik ulang di dua tempat

**Bukti** [dibaca]. Kanonik `progress-calc.ts:81` menjaga `grandTotal <= 0`.
Salinan:

| Lokasi | Kode | Perilaku |
|---|---|---|
| `export/rincian-jadwal.ts:132` | `(n.amount / grandTotal) * 100` | Setara — penjaga ada di baris 103 |
| `paparan/snapshot.ts:274` | `totalRabPaket > 0 ? (amountKat / totalRabPaket) * 100 : 0` | Setara — penjaga inline |

**Keduanya tidak menghasilkan angka berbeda hari ini.** Dugaan awal saya bahwa
`rincian-jadwal.ts` menghasilkan `Infinity` saat grandTotal 0 (fixture emas #12)
**salah** — penjaganya ada. Yang tersisa: perubahan pada `bobotPct` kanonik
tidak akan sampai ke dua salinan ini.

Ironinya, `snapshot.ts:24–27` menyatakan dirinya "Formula tidak ditulis ulang"
tepat 250 baris di atas tempat formula itu ditulis ulang.

## I-3 — Agregasi per-kategori bikinan sendiri + `BigInt` jadi `Number`

**Bukti** [dibaca]: `src/lib/paparan/snapshot.ts:264–275`

```ts
nilaiRealisasi += (prestasiPct(volSd, volK) / 100) * Number(it.amount);
realisasiPct: amountKat > 0 ? Math.min(100, (nilaiRealisasi / amountKat) * 100) : 0,
```

`prestasiPct` kanonik dipakai (baik), tetapi pembobotan & penjumlahan
per-kategori disusun sendiri, dan rupiah `BigInt` diubah jadi `Number` tanpa
alasan tertulis — gerbang rounding meminta ini dihindari. Angkanya masuk slide
paparan KKP (`paparan/render-pdf.ts:420`) yang dilihat pemberi kerja.

## I-4 — Penghapusan foto & lampiran kegiatan tidak beraudit

**Bukti** [dibaca]: `src/lib/field-activity/actions.ts:501`
(`removeActivityPhotoAction`) dan `:623` (`removeActivityAttachmentAction`).
Keduanya menegakkan `requireCapability("field_activity.manage")` +
`requireLocationAccess` + penolakan bila kegiatan `final` — **tetapi tidak
memanggil `audit()`**, padahal menghapus baris `Photo` dan objek R2 secara
permanen.

`CLAUDE.md` butir 3 mewajibkan `audit()` pada setiap mutasi. Dari sapuan penuh,
inilah **satu-satunya dua aksi memutasi yang punya capability tetapi tanpa
jejak** — pembanding `hapusKegiatan` di berkas yang sama (`:492`) beraudit.

## I-5 — Berkas ASLI foto tertinggal di R2 saat kegiatan dihapus

**Bukti** [dibaca]. Empat jalur penghapusan foto, dua di antaranya melupakan
`originalKey`:

| Jalur | Kunci yang dihapus | `originalKey`? |
|---|---|---|
| `photos.ts:576` | `key`, `thumbnailKey`, `originalKey` | ✅ |
| `foto-cepat/service.ts:160` | … `originalKey` | ✅ |
| `field-activity/actions.ts:488` (hapus kegiatan) | `r2Key`, `thumbnailKey` | ❌ |
| `field-activity/actions.ts:523` (hapus satu foto) | `r2Key`, `thumbnailKey` | ❌ |

Baris `Photo` dihapus, tetapi berkas aslinya tetap di R2 **tanpa ada lagi yang
menunjuk ke sana** — tak bisa ditemukan, tak bisa dibersihkan, terus dibayar.

Perlu dicatat arahnya: DECISIONS 197 melarang menghapus **jalur arsip**, bukan
mewajibkan menyimpan yatim. Yang tersisa di sini bukan arsip yang bisa dipakai
memperbaiki cap — ia sampah yang tak punya induk.

## I-6 — Dua uji E2E dimatikan permanen karena data seed tak punya kasusnya

**Bukti** [dibaca]:

| Spec | Baris | Alasan tertulis |
|---|---|---|
| `tests/e2e/paket-drawer.spec.ts` | 108 | `test.skip(true, "Tidak ada paket berselisih kontrak vs RAB pada data seed ini.")` |
| `tests/e2e/konfirmasi.spec.ts` | 39 | `test.skip(true, "Tidak ada penanggung jawab yang perlu ditagih pada data seed hari ini.")` |

Yang pertama mematikan pemeriksaan **selisih kontrak vs RAB** — jalur peringatan
PPN yang `PROJECT.md` §3 sebut ("warning selisih >0.1%"). Yang kedua bergantung
pada "hari ini", jadi lulusnya tidak bermakna.

Repo ini sudah tahu prinsipnya — `tests/e2e/harian-tata-letak-input.spec.ts:72`:
*"Jalan keluarnya BUKAN `test.skip`. Uji yang melewat tidak membuktikan apa pun"*.

**Rekomendasi.** Tambahkan kasusnya ke seed, bukan mematikan ujinya.

Pembanding [CI]: 55 skip lain **sah** — penjaga profil `mobile`/`desktop`.

## I-7 — N+1 query di penyusun paparan, padahal obatnya sudah ada di repo

**Bukti** [dibaca]: `src/lib/paparan/snapshot.ts:238–256` — perulangan per lokasi
yang menembakkan tiga query di tiap putaran:

```ts
for (const l of lokasi) {
  const rev  = await db.rabRevision.findFirst({ ... });        // 1
  const nodes = await db.rabNode.findMany({ ... });            // 2
  const volCum = await cumulativeVolumeByLineage(l.id, asOf);  // 3
```

Versi banyak-lokasi **sudah ada**: `progress.ts:417`
`cumulativeVolumeByLineageMulti`, yang komentarnya sendiri mendiagnosis persis
persoalan ini:

> Memanggil versi satu-lokasi di dalam perulangan berarti 83 query di jalur yang
> dijalankan tiap kali orang bertanya ke Ask MARLIN.

Obat itu dipakai `ai-hub/source.ts:318`, tetapi **tidak** di `paparan/snapshot.ts`.
Biayanya 3 × jumlah lokasi paket per penyusunan paparan — bukan 83 (satu paket
tidak memuat seluruh lokasi), tetapi tumbuh linear dan tidak perlu.

## I-8 — `main` sempat merah 12 jam

**Bukti** [CI]: run `33084550780` (27 Agu 14:51, "Rombak asisten AI dan
percakapan WhatsApp") gagal di job `Integration tests (Postgres)` — 9 uji di
`tests/integration/waha-tanya-jawab.test.ts` merah, termasuk "orang LAIN di grup
tidak bisa membajak klarifikasi" dan "jawaban yang DIULANG tidak dijalankan dua
kali". PR-nya (`33084540364`) juga merah, jadi merahnya terlihat sebelum merge
dan tetap di-merge. Sudah diperbaiki — run `33136837467` hijau seluruhnya.
Dicatat sebagai pola, bukan kerusakan yang masih ada.

---

# 🟢 NICE-TO-HAVE

**G-1 — Presentation contract praktis belum ada.** Hitungan pemakaian di seluruh
`src` [JALAN]: `calculationKey` **0**, `sourceEntityIds` **0**, `statusLevel` 4,
`dataAsOf` 23, `revisionId` 171, `baselineId` 35. Protokol sendiri sudah
menyatakan ini belum terpasang dan menunggu keputusan user; angka di atas
sekadar mengukurnya.

**G-2 — Enam dokumen di luar peta `docs/README.md`**:
`AUDIT_MENYELURUH_2026-07-28.md`, `integrated-control/UX_INFORMATION_ARCHITECTURE.md`,
`rebuild/UJI_KENDALA.md`, `rebuild/PETA_KENDALA.md`, `manual/bab/01-lapangan.md`,
`manual/bab/02-manajemen.md`.

**G-3 — Berkas raksasa.** Sepuluh berkas di atas 1.000 baris; teratas
`lib/package/actions.ts` (1.932), `lib/daily-report/actions.ts` (1.453),
`lib/waha/tanya.ts` (1.346), `harian/[date]/report-editor.tsx` (1.153). Berkas
`actions.ts` sebesar itu membuat gerbang `requireCapability()` + `audit()` sulit
diperiksa mata — sapuan otomatis di audit ini butuh tiga kali perbaikan alat
justru karena itu.

**G-4 — Satu dependency tidak dipin eksak** [JALAN]: `@types/pdfkit@^0.17.6`
(40 dari 41 lainnya dipin eksak sesuai `DEPENDENCY_POLICY.md`). Hanya tipe,
tidak masuk runtime.

**G-5 — Node lokal tidak sesuai pin** [JALAN]: mesin ini v22.23.2, sementara
`.nvmrc` 24.18.0, `engines` `>=24 <25`, dan Dockerfile `node:24.18.0`. Uji tetap
lulus, tetapi lokal ≠ CI ≠ produksi.

**G-6 — E2E lambat dan satu flaky** [CI]. `mobile-overflow.spec.ts` memakan 6,3
dari 11,5 menit. `harian-tata-letak-input.spec.ts:222` tercatat flaky.

---

# Yang diperiksa dan terbukti SEHAT

Supaya proporsinya jujur:

**Penegakan otorisasi — rapat.** Sapuan atas 244 aksi server terekspor
(102 di antaranya memutasi data) menemukan **nol** mutasi tanpa capability,
selain kasus yang memang tidak mungkin punya capability (`login`,
`changePassword`) dan C-5 di atas. Pola yang dipakai konsisten: helper penjaga
terpusat (`guard()` di `issues.ts:38`, `guardTemuan()` di `findings/actions.ts`)
atau delegasi ke modul terjaga (`documents-manage.ts`).

**Audit atomik untuk uang & status.** `audit.ts` membedakan `audit()`
(best-effort, terdokumentasi) dari `auditIn()` (di dalam transaksi, melempar
ulang) — dipakai di `finance/actions.ts`, `daily-report/{service,actions}.ts`,
`package/actions.ts`, dijaga `tests/integration/audit-atomik.test.ts`.
Pembagian yang benar.

**Aksi paling berbahaya di sistem dijaga berlapis.** `resetOperationalData`
(`system/actions.ts:117`) menuntut capability `system.manage` **dan**
`APP_ENV !== "production"` **dan** ketikan konfirmasi `"KOSONGKAN"`, lalu
mencatat audit.

**Tidak ada celah injeksi SQL.** 28 pemakaian raw SQL; satu-satunya
`$executeRawUnsafe` adalah 10 `TRUNCATE` bertuliskan tetap di dalam aksi reset
di atas — tanpa interpolasi.

**Tidak ada rahasia terkomit.** `git ls-files` hanya memuat `.env.example`; tidak
ditemukan literal rahasia di `src`, `prisma`, atau `scripts`.

**`valueDone` tidak dipakai sebagai basis agregat progres.** Seluruh jalur
kurva-S dan dashboard memakai volume + bobot revisi aktif, alasannya tertulis di
`periodic-report.ts:685`. Penyimpangan tunggalnya adalah I-1, dan itu di kolom
bobot harian, bukan basis resmi.

**Gerbang date-as-of.** Tidak ditemukan `new Date()` tersembunyi di jalur laporan
periode lampau. Polanya parameter `now` yang bisa disuntik
(`mingguan/kirim.ts:168`, `mingguan/penjadwal.ts:30`) dan pembungkus
`jakartaDateKey`. Sisa `new Date()` hanya untuk cap "Dibuat …" di footer.

**Gerbang lineage.** `cumulativeVolumeByLineage` (`progress.ts:384`) menyaring
`basis: "aktif"` + `COUNTED_REPORT_STATUSES` + `reportDate <= upToDate`, dan
versi banyak-lokasinya menegaskan saringannya "sama persis" — dua angka
kumulatif beraturan beda adalah cara tercepat membuat dua layar tidak sepakat.

**Batas 100% hanya di kumulatif**, kolom periode diturunkan dengan pengurangan —
`progress-calc.ts:44–61`, persis sesuai protokol.

**CI menjalankan uji integrasi sungguhan** [CI]: job `integration` terpisah
dengan service `postgres:16` (`ci.yml:72–107`), plus job docker build dan E2E.

**Invarian di DB, bukan hanya di kode**: partial unique index satu revisi RAB +
satu baseline aktif per lokasi; 121 `@@index`, 33 `@@unique`, 84 migrasi.

**Dokumen turunan berpenjaga**: `PERMISSION_MATRIX.md` dibangkitkan dari
`authz.ts` dan dijaga uji; aturan en-dash dijaga `tanda-pisah-ui.test.ts`;
larangan `<select>` ditegakkan `eslint.config.mjs`.

**Hanya satu `catch {}` kosong** di seluruh `src`, dan itu di dalam skrip inline
browser (`shell/sidebar-ringkas.ts:56`).

---

# Catatan metodologi — untuk auditor berikutnya

Sapuan otomatis di audit ini **salah tiga kali** sebelum benar. Dicatat supaya
tidak diulang:

1. **Mencari `requireCapability` di dalam badan fungsi** menandai 9 aksi di
   `issues.ts` sebagai tak terjaga. Salah: otorisasinya dipusatkan di helper
   lokal `guard()` (`issues.ts:38`). Alat harus mengikuti indireksi helper.
2. **`grep -l '"use server"'`** memasukkan 4 berkas yang hanya *menyebut* string
   itu di komentar — termasuk `kendala/naikkan.ts`, yang justru menjelaskan
   mengapa ia sengaja **bukan** modul `"use server"`. Harus memeriksa baris
   efektif pertama.
3. Bahkan setelah dua perbaikan itu, 37 aksi tampak "tanpa penjaga" karena
   mendelegasikan ke modul lain (`documents-manage.ts`) atau helper bernama lain
   (`guardTemuan`). Verifikasi manual tetap wajib sebelum menuduh.

Pelajarannya: di repo ini, ketiadaan pola tekstual **bukan** bukti ketiadaan
penjaga. Setiap tuduhan otorisasi harus dibaca manual sampai ke sumbernya.

---

# Urutan penanganan yang disarankan

1. **C-5** — permukaan endpoint `buatSurat`. Perbaikannya kecil (pindah berkas),
   dampaknya register surat resmi, dan polanya sudah ada di `naikkan.ts`.
2. **C-1 + C-2** — murni dokumentasi, prasyarat semua temuan kalkulasi:
   selama daftar kanonik bercabang dan protokol menunjuk arsip, tidak ada patokan tetap.
3. **C-3** — uji `unbilledWork` + `cashRequirement`. Fungsi murni, murah,
   menutup satu-satunya modul kanonik tanpa penjaga.
4. **I-4 + I-5** — sekali sentuh: tambahkan `audit()` dan sertakan `originalKey`
   pada dua jalur hapus di `field-activity/actions.ts`.
5. **C-4** — pindahkan agregasi uang ke `finance/calc.ts`; sekalian membuka jalur
   AI yang sengaja ditutup.
6. **I-1** — perbaiki basis `bobotToday`, dengan fixture adendum harga.
7. **I-2, I-3, I-7** — hapus duplikasi, angkat realisasi per-kategori jadi
   kanonik, pakai helper volume banyak-lokasi.
8. **I-6** — tambahkan kasus ke seed, hidupkan kembali dua spec.

# Keputusan yang menunggu Anda

- **C-1**: status kanonik `plan/rencana-format.ts` dan `ahsp/rapl-calc.ts`?
- **C-5**: `buatSurat` dipindah ke modul biasa, atau diberi penjaga sendiri?
- **I-1**: `bobotToday` diperbaiki basisnya, atau diganti namanya?
- **I-5**: berkas asli yatim di R2 — dibersihkan sekali jalan, atau dibiarkan?
- **C-4**: memindahkan Σ keuangan menyentuh halaman yang sudah bekerja — sekarang
  atau dijadwalkan?

# Batas audit ini

- Uji integrasi & E2E tidak dijalankan auditor (tidak ada Postgres/Docker lokal);
  klaim hijau untuk keduanya berasal dari CI. Typecheck, lint, dan 2.415 uji unit
  **dijalankan** dan hijau.
- DATA-03 di `OPEN_ISSUES.md` (RAB terlanjur diimpor melebihi 8–18%) adalah **isu
  data produksi**, bukan isu logika, dan sengaja tidak dicampur ke temuan di atas.
- Cakupan uji diukur berbasis risiko (pemetaan modul → uji), bukan persentase
  baris — tidak ada alat coverage terpasang, dan memasangnya berarti mengubah repo.
- N+1 disapu dengan pola kasar; hanya satu kasus (I-7) yang ditelusuri sampai
  terbukti. Sisanya tidak dinyatakan bersih, hanya tidak diperiksa.
- Kinerja runtime, keamanan dependency pihak ketiga (`pnpm audit` dijalankan CI,
  bukan di sini), dan ketahanan PWA luring tidak diaudit.
