# Audit Menyeluruh MARLIN GIBAKU

**Tanggal audit:** 28 Juli 2026
**Repository/branch:** `topikuning/marlin-gibaku` / `dev`
**Commit yang diaudit:** `605218e1e7e0afbff76a05afc8155b7dcca68b3d`
**Sifat audit:** audit statis source code, model data, algoritma, alur otorisasi, transaksi, pengujian, dan operasi CI/CD
**Auditor:** Codex

> Dokumen ini sengaja menyediakan blok **“Tanggapan / Tantangan Balik” pada setiap temuan**. Claude atau reviewer lain dapat mengisi bantahan, bukti tandingan, keputusan, dan status tindak lanjut langsung di bawah temuan yang bersangkutan.

---

## 1. Ringkasan eksekutif

MARLIN memiliki fondasi domain yang jauh lebih baik daripada aplikasi CRUD biasa: formula progres dipusatkan, lifecycle status eksplisit, riwayat penting dibuat append-only, keuangan memakai integer rupiah (`BigInt`), snapshot final laporan disediakan, dan race condition pada pembayaran sudah ditangani dengan row lock. Build, lint, typecheck, 428 unit test, serta audit lisensi lulus pada commit yang diaudit.

Namun, aplikasi **belum layak dianggap aman sebagai sistem multi-organisasi**. Model data secara eksplisit memiliki `Organization` dan `orgId`, tetapi beberapa jalur otorisasi mengartikan peran lintas-lokasi sebagai “boleh melihat semua lokasi di seluruh database”, bukan “semua lokasi dalam organisasi pengguna”. Sejumlah mutasi paket, pengelolaan pengguna, data AI, konfigurasi, dan halaman sistem juga memakai UUID atau query global tanpa batas `orgId`. Bila lebih dari satu organisasi hidup dalam database yang sama, pengguna berwenang dari organisasi A secara teknis dapat membaca atau mengubah data organisasi B apabila memperoleh UUID yang relevan; pada beberapa halaman UUID bahkan tidak perlu ditebak karena datanya ikut ditampilkan.

Risiko integritas angka terpenting ada pada snapshot final laporan harian. Volume item sudah dihitung `as-of reportDate`, tetapi blok progres di snapshot masih mengambil progres saat ini: seluruh laporan counted sampai hari finalisasi, revisi aktif saat ini, baseline aktif saat ini, dan minggu saat ini. Finalisasi terlambat atas laporan lama dapat membekukan angka masa depan ke dokumen historis.

Risiko concurrency kedua terdapat pada submit laporan harian. Guard volume membaca total laporan lain lalu mengubah status dalam transaksi default, tetapi tidak mengunci sumber daya bersama. Dua laporan berbeda dapat lolos secara bersamaan dan membuat volume counted melebihi RAB. Pola yang sama sudah dikenali dan diperbaiki dengan `SELECT ... FOR UPDATE` pada domain keuangan, tetapi belum diterapkan pada domain laporan.

### Keputusan yang paling mendesak

1. Tetapkan kontrak tenancy: **single-organization permanen** atau **multi-organization sungguhan**.
2. Jika multi-organisasi, tutup semua jalur P0 sebelum memasukkan organisasi kedua atau go-live.
3. Perbaiki snapshot historis dan race submit sebelum laporan dipakai sebagai dokumen resmi.
4. Tambahkan suite uji lintas-tenant, concurrency laporan, parity output, dan alur E2E domain utama.

### Distribusi temuan

| Prioritas | Jumlah | Makna |
|---|---:|---|
| P0 / Kritis | 3 | Dapat merusak isolasi organisasi atau akun lintas-tenant |
| P1 / Tinggi | 7 | Dapat mengubah angka resmi, melewati izin, atau membiarkan perubahan penting tidak teruji |
| P2 / Sedang | 7 | Inkonsistensi model/formula, hardening, dan risiko operasional |

---

## 2. Ruang lingkup, metode, dan batasan

### 2.1 Yang diperiksa

- 321 file TypeScript/TSX aplikasi, sekitar 56.441 baris di luar Prisma Client hasil generate.
- Prisma schema, seluruh migration, seed, dan trigger database.
- Session, role/capability, location scope, server actions, serta route handler.
- Domain paket/kontrak, RAB, baseline/kurva-S, laporan harian/periodik, progres, keuangan, foto/dokumen, AI Hub, WAHA, Google Drive, dan konfigurasi sistem.
- Dokumentasi sumber kebenaran: `PROJECT.md`, `CALCULATION_INTEGRITY_PROTOCOL.md`, `DOMAIN_MODEL.md`, `TEST_PLAN.md`, `DECISIONS.md`, dan `OPEN_ISSUES.md`.
- Workflow GitHub Actions, dependency tree, build, lint, typecheck, dan unit test.

### 2.2 Metode

Audit mengikuti aliran berikut:

1. Petakan entitas dan lifecycle.
2. Ikuti request dari session → capability → scope → query/mutasi → audit.
3. Rekonstruksi formula progres, laporan, baseline, dan keuangan dari sumber datanya.
4. Cari perbedaan antara dokumentasi kanonik dan implementasi.
5. Tinjau boundary transaksi dan skenario request paralel.
6. Cocokkan klaim kontrol dengan pengujian yang benar-benar tersedia.
7. Jalankan verifikasi lokal yang tidak membutuhkan infrastruktur eksternal.

### 2.3 Batasan

- Tidak ada akses ke database produksi, data produksi, bucket R2, WAHA, Google Drive, atau provider AI.
- Docker/PostgreSQL tidak tersedia pada mesin audit; 5 file integration test tidak dijalankan.
- Satu file E2E Playwright tidak dijalankan karena memerlukan PostgreSQL, seed, server, dan browser.
- `gh` CLI tidak tersedia; status run GitHub Actions historis tidak diverifikasi dari mesin lokal.
- Ini bukan penetration test jaringan dan bukan audit konfigurasi deployment yang sedang hidup.
- Temuan race condition merupakan hasil analisis concurrency yang kuat, tetapi belum direproduksi pada PostgreSQL dalam audit ini.

---

## 3. Peta proses “di belakang layar”

## 3.1 Autentikasi dan otorisasi

Alur normal:

1. Login memvalidasi kredensial dan rate limit.
2. Server membuat token acak, menyimpan hash token di tabel `Session`, lalu mengirim cookie.
3. Setiap request membaca session, memeriksa expiry/revocation, status user, dan `tokenVersion`.
4. `requireCapability()` memeriksa role terhadap permission matrix.
5. Operasi berbasis lokasi seharusnya memanggil `requireLocationAccess()`.
6. Mutasi domain dijalankan, kemudian helper `audit()` menulis jejak.

Masalah arsitekturalnya berada pada langkah 5: peran “cross-location” langsung dianggap punya akses ke lokasi apa pun, tanpa terlebih dahulu memastikan lokasi itu milik `user.orgId`.

## 3.2 Paket sampai pelaksanaan

Paket bergerak melalui lifecycle prospek/tender/penetapan/kontrak/pelaksanaan/serah-terima/batal. Transisi divalidasi oleh state machine dan dicatat ke history append-only. Kontrak mengikat paket dan vendor; lokasi berada di bawah paket. RAB aktif dan baseline aktif berada per lokasi.

Kontrol lifecycle sudah baik, tetapi kontrol “aktor ini boleh menyentuh paket yang mana” tidak konsisten. Banyak action hanya memeriksa capability global lalu mencari paket dengan UUID.

## 3.3 RAB, progres, dan kurva-S

Formula kanonik pada `src/lib/progress.ts`:

```text
grandTotal = Σ amount node kategori pada revisi RAB aktif

prestasi_item = clamp(Σ volume counted / volume RAB aktif, 0, 1)
realizedValue = Σ prestasi_item × amount item aktif
realizedPct = realizedValue / grandTotal × 100

planPct = titik baseline aktif pada minggu berjalan
deviationPct = realizedPct - planPct
```

Status laporan counted adalah `dikirim`, `disetujui`, dan `final`. `draft` serta `perlu_koreksi` tidak memengaruhi progres.

Generator baseline:

1. Item dipetakan ke kategori/unit.
2. Nama kategori dan nama item dipakai untuk mendeteksi tipe pekerjaan.
3. Item diklasifikasikan ke tahap konstruksi.
4. Tahap ditempatkan di jendela waktu kategori.
5. Bobot item disebar sebagai kurva lonceng per minggu.
6. Semua item dijumlahkan menjadi profil kategori dan kurva kumulatif, maksimum 100%.

Kelemahan yang ditemukan: identitas kategori di bagian algoritma masih menggunakan nama tampilan, bukan `lineageKey`.

## 3.4 Laporan harian dan laporan periodik

Laporan harian unik per lokasi dan tanggal. Ia bergerak:

```text
draft/perlu_koreksi → dikirim → disetujui → final
```

Ketika masuk `dikirim`, volume divalidasi kembali terhadap RAB. Saat final, sistem menyimpan `finalSnapshot` untuk menjaga hasil cetak tetap immutable.

Laporan periodik menghitung ulang data terhadap rentang tanggal dan RAB aktif. Ia membagi volume menjadi sebelum periode dan dalam periode, lalu menghitung prestasi item yang di-clamp 100%.

## 3.5 Keuangan

Pembayaran invoice dan pencairan termin menggunakan transaksi dan `SELECT ... FOR UPDATE` pada baris induk. Setelah lock:

```text
remaining invoice = invoice.amount - Σ payment
payable termin = billing.amount - retentionHeld
remaining termin = payable - Σ disbursement
```

Request kedua menunggu request pertama commit, lalu menghitung sisa terbaru. Ini adalah contoh kontrol concurrency yang tepat dan dapat dijadikan pola untuk submit laporan.

## 3.6 AI Hub

AI tidak dimaksudkan sebagai sumber angka. Aplikasi menyusun sumber deterministik dari calculation layer, menghitung readiness, memanggil provider, memvalidasi output terstruktur, dan menyimpan source snapshot serta output. Artefak melewati lifecycle draft → review → approve → freeze → distribute.

Secara konsep ini baik. Masalahnya: `AiRun` dan `AiArtifact` tidak memiliki organisasi eksplisit, sementara pembacaan/pengubahan bergantung pada scope lokasi yang mempunyai semantik `null = semua`.

## 3.7 Foto, dokumen, dan integrasi

- Foto: validasi → hash sumber → dedup → EXIF/GPS/waktu → cap/kompresi → upload R2 → row database.
- Dokumen: metadata memiliki `orgId`, hash, dan relasi opsional ke paket/lokasi.
- WAHA dan Google Drive: konfigurasi dibaca dari setting/environment, lalu dipakai pada server-side integration.

Ada ketidakseimbangan: dokumen sadar organisasi, sedangkan foto, `AppSetting`, `AuditLog`, dan AI tidak memiliki `orgId` langsung.

---

## 4. Kontrol yang sudah baik

Bagian ini penting agar audit tidak hanya menginventarisasi kekurangan.

1. **Formula progres dipusatkan.** SQL actual progress dan helper persentase mempunyai clamp bawah/atas dan komentar invariannya jelas.
2. **Lifecycle eksplisit.** Paket, lokasi, laporan, invoice, termin, dan artefak AI tidak hanya mengandalkan string bebas.
3. **History append-only di database.** Trigger mencegah update/delete pada package stage history, location status history, daily report status history, contract amendment, dan audit log.
4. **Satu revisi/baseline aktif.** Partial unique index database mengurangi race aktivasi ganda.
5. **Rupiah memakai integer.** `BigInt` menghindari floating-point untuk nilai uang utama.
6. **Keuangan sadar concurrency.** Row lock dan integration race test sudah ada untuk pembayaran/pencairan.
7. **Final snapshot tersedia.** Desain membekukan dokumen final adalah keputusan yang tepat; implementasi as-of-nya saja belum lengkap.
8. **AI dibatasi sebagai penjelas.** Source snapshot, schema validation, readiness, confidence, dan limitation adalah kontrol yang sehat.
9. **Environment divalidasi.** Build tanpa `DATABASE_URL` dan `SESSION_SECRET` sengaja gagal; build dengan environment setara CI lulus.
10. **Toolchain dasar hijau.** Typecheck, lint, unit test, production build, dan audit lisensi lulus.

---

## 5. Daftar temuan prioritas

| ID | Prioritas | Keyakinan | Ringkasan |
|---|---|---:|---|
| AUTH-01 | P0 Kritis | Tinggi | Peran lintas-lokasi berarti lintas seluruh organisasi |
| AUTH-02 | P0 Kritis | Tinggi | Mutasi paket/kontrak berbasis UUID tanpa tenant scope |
| AUTH-03 | P0 Kritis | Tinggi | Administrasi pengguna dapat membaca/mengubah akun lintas-organisasi |
| AUTH-04 | P1 Tinggi | Tinggi | AI run/artifact tidak mempunyai boundary organisasi |
| AUTH-05 | P1 Tinggi | Tinggi | Route PDF melewati capability `report.export` |
| CALC-01 | P1 Tinggi | Tinggi | Snapshot final historis memakai progres/revisi/baseline saat ini |
| CALC-02 | P1 Tinggi | Sedang-Tinggi | Submit laporan paralel dapat melampaui volume RAB |
| CALC-03 | P2 Sedang | Tinggi | Formula `grandTotal` periodik bercabang dari formula kanonik |
| CALC-04 | P2 Sedang | Tinggi | Generator baseline mengunci kategori berdasarkan nama, bukan lineage |
| DATA-01 | P1 Tinggi | Tinggi | Integritas tenant antar-entitas tidak dijaga database |
| DATA-02 | P2 Sedang | Tinggi | Setting, audit, dan sebagian data domain bersifat global |
| STORE-01 | P2 Sedang | Sedang-Tinggi | Dedup foto global dan upload tidak atomik dengan metadata |
| AUDIT-01 | P2 Sedang | Tinggi | Audit log best-effort dan tidak atomik dengan mutasi |
| SEC-01 | P2 Sedang | Tinggi | Health endpoint publik mengembalikan pesan error database mentah |
| SUPPLY-01 | P2 Sedang | Tinggi | Empat advisory moderat masih ada di dependency production tree |
| CI-01 | P1 Tinggi | Tinggi | Push langsung ke `dev` tidak menjalankan CI |
| TEST-01 | P1 Tinggi | Tinggi | Jalur bisnis dan isolasi paling kritis belum tertutup test |

---

## 6. Temuan rinci

## AUTH-01 — Peran lintas-lokasi berarti lintas seluruh organisasi

**Prioritas:** P0 / Kritis
**Keyakinan:** Tinggi
**Status:** Temuan baru/root cause
**Dampak:** Confidentiality dan integrity lintas-tenant

### Bukti

- `src/lib/auth/session.ts:132-139`: `hasLocationAccess()` langsung `return true` untuk role cross-location.
- `src/lib/auth/session.ts:146-153`: `accessibleLocationIds()` mengembalikan `null` untuk role tersebut, dengan arti “semua”.
- Fungsi tidak mengambil lokasi/paket untuk membuktikan `package.orgId === user.orgId`.
- Schema memiliki `Organization`, `User.orgId`, `Package.orgId`, dan `Vendor.orgId`; jadi tenancy bukan sekadar label UI.

### Mekanisme kegagalan

Seorang `super_admin`, `program_director`, atau `exec_viewer` organisasi A lolos pemeriksaan lokasi organisasi B. Banyak caller mengandalkan helper ini sebagai boundary terakhir. Semantik `null = semua` juga mudah diteruskan menjadi `where: undefined`, yang berarti seluruh database.

### Skenario

1. User A memperoleh slug atau UUID lokasi B dari tautan, log, ekspor, autocomplete global, atau tebakan tidak langsung.
2. Route memanggil `hasLocationAccess(userA, locationB)`.
3. Karena role A cross-location, fungsi mengembalikan `true` tanpa query organisasi.
4. Data B dibaca atau diteruskan ke action lain.

### Rekomendasi

- Ganti kontrak menjadi `accessibleLocationIds()` selalu menghasilkan lokasi dalam `user.orgId`; bila ingin optimasi, return object seperti `{ orgId, unrestrictedWithinOrg: true }`, bukan `null`.
- `hasLocationAccess()` harus selalu membuktikan:

```text
location.id = requestedId
AND location.package.orgId = user.orgId
AND (
  role unrestrictedWithinOrg
  OR active assignment exists
)
```

- Tambahkan `requirePackageAccess()` dan query helper tenant-aware; jangan mengulang filter secara ad hoc.
- Tambahkan multi-org fixtures dan negative authorization tests.
- Bila produk memang single-org, hapus ilusi multi-tenant atau enforce persis satu Organization di startup/database dan dokumentasikan keputusan itu.

### Kriteria penerimaan

- Role tertinggi organisasi A mendapat 404/403 pada setiap lokasi organisasi B.
- Tidak ada semantik `null = seluruh database`.
- Test matrix mencakup read, export, mutate, dan AI untuk dua organisasi.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

Diverifikasi ke kode: `hasLocationAccess()` memang `return true` untuk role
lintas-lokasi tanpa menyentuh organisasi sama sekali. Tidak ada pembelaan.

Satu koreksi terhadap ruang lingkup temuan: jalur DAFTAR sudah dijaga sejak
DECISIONS 155 (B11) lewat `src/lib/auth/scope.ts` —
`locationScopeWhere(user, null)` menghasilkan `{ package: { orgId: user.orgId } }`,
bukan `where: undefined`. Jadi kebocoran yang nyata ada pada pemeriksaan objek
TUNGGAL (34 titik pemanggil `hasLocationAccess`/`requireLocationAccess`), bukan
pada semua query. Itu tetap lubang: justru di situlah halaman lokasi, route PDF,
dan server action bergantung.

**Perbaikan:** `hasLocationAccess()` kini SELALU membuktikan lokasi berada di
`user.orgId` lebih dulu, baru mempertimbangkan role/assignment. Biayanya satu
query tambahan untuk role lintas-lokasi — murah untuk penjaga terakhir.

Kontrak `accessibleLocationIds()` sengaja TETAP mengembalikan `null`, tetapi
maknanya didokumentasikan ulang: "tanpa batas DI DALAM organisasi", dan wajib
diterjemahkan lewat `locationScopeWhere`. Mengganti kontrak ke object di 23
pemanggil berisiko lebih besar daripada manfaatnya sekarang; yang ditegakkan
adalah larangan memakainya sebagai `where: undefined`.

**Apakah deployment dijamin satu Organization?** Belum dijamin apa pun. Karena
itu perbaikan ini TIDAK menunggu keputusan tenancy: menambah filter `orgId`
adalah no-op pada single-org dan perbaikan nyata pada multi-org. Keputusan
tenancy formal masih milik user (lihat catatan penutup).

---

## AUTH-02 — Mutasi paket dan kontrak berbasis UUID tanpa tenant scope

**Prioritas:** P0 / Kritis
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** IDOR/server-action authorization bypass lintas-organisasi

### Bukti

Contoh di `src/lib/package/actions.ts`:

- `updatePackage`, baris 157-194: hanya `requireCapability("package.edit")`, lalu `package.findUnique({ id })`.
- `advanceStage`, baris 212-260: capability lalu lookup/update UUID.
- `revertStage`, baris 295-325: pola yang sama.
- `addTargetLocation`, baris 360-416: lokasi dibuat pada paket UUID tanpa pemeriksaan `orgId`.
- `convertToContract`, sekitar baris 667-708: paket dan vendor dicari dengan UUID tanpa memastikan keduanya berada pada organisasi aktor.
- Pola serupa terdapat pada edit kontrak, signatory, mulai pelaksanaan, dan amendment.

### Mekanisme kegagalan

Server action adalah endpoint yang dapat dipanggil langsung; menyembunyikan tombol bukan kontrol keamanan. Capability menjawab “boleh mengedit paket”, tetapi bukan “paket organisasi mana”. Karena UUID adalah satu-satunya selector, aktor ber-capability dari A dapat mengubah B.

### Dampak lanjutan

- Stage dan history paket B dapat berubah.
- Lokasi baru dapat ditanamkan ke paket B.
- Kontrak dapat menghubungkan paket B dengan vendor A karena database juga tidak menjaga kesamaan organisasi.
- Audit mencatat aktor A, tetapi tidak mencegah atau menandai pelanggaran tenant.

### Rekomendasi

- Semua lookup paket menggunakan `{ id, orgId: actor.orgId }` melalui helper tunggal.
- Untuk operasi lokasi, gunakan package/org scope dan assignment bila role terbatas.
- Validasi vendor dengan `{ id, orgId: actor.orgId }`.
- Tambahkan transaction invariant bahwa paket, vendor, lokasi, dan aktor berada di tenant yang sama.
- Gunakan not-found untuk objek tenant lain agar tidak membocorkan eksistensi.

### Kriteria penerimaan

- Direct invocation setiap server action dengan UUID tenant B ditolak.
- Tidak mungkin membuat `Contract(package.orgId=A, vendor.orgId=B)`.
- Test mencakup seluruh action paket, bukan hanya page navigation.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

Diverifikasi: `updatePackage` (baris 175), `advanceStage`, `revertStage`,
`addTargetLocation`, `convertToContract`, dan jalur kontrak lain memang mencari
paket/vendor/lokasi hanya dengan UUID. Argumen auditor benar dan tidak bisa
dibantah: server action adalah endpoint yang bisa dipanggil langsung.

**Perbaikan:** seluruh lookup di `src/lib/package/actions.ts` kini ber-scope
organisasi aktor — 23 titik:

- `package.findUnique({ id })` → `findFirst({ id, orgId: actor.orgId })`
- `vendor.findUnique({ id })` → `findFirst({ id, orgId: actor.orgId })`
- `contract.findUnique({ id })` → `findFirst({ id, package: { orgId: actor.orgId } })`
- `location.findUnique({ id })` → `findFirst({ id, package: { orgId: actor.orgId } })`

Objek tenant lain kini jatuh ke cabang "tidak ditemukan" yang sudah ada, jadi
tidak membocorkan eksistensi. Pemeriksaan duplikat `contractNumber` dan
`(contractId, ccoNumber)` SENGAJA tetap global — itu uji keunikan, bukan jalur
akses; membatasinya per-organisasi justru mengizinkan nomor kontrak kembar.

**Belum:** invariant di level database (paket & vendor satu organisasi) — lihat
tanggapan DATA-01. Perbaikan ini menutup jalur aplikasi, bukan raw SQL.

---

## AUTH-03 — Administrasi pengguna dapat membaca/mengubah akun lintas-organisasi

**Prioritas:** P0 / Kritis
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** Account takeover/denial of service lintas-tenant

### Bukti

- `src/app/(app)/master/pengguna/page.tsx:21-55`: user dengan `user.manage` memperoleh `where: undefined` untuk user dan lokasi, sehingga seluruh organisasi ditampilkan.
- `src/lib/users/actions.ts:110-111`: `updateUserProfile` sudah memeriksa `target.orgId === actor.orgId`; ini menunjukkan boundary yang diinginkan.
- Tetapi `setUserActive`, baris 125-130, langsung update UUID.
- `resetUserPassword`, baris 134-144, langsung mengganti password dan revoke session UUID.
- `setAssignments`, baris 149-167, dapat memasangkan user mana pun ke location mana pun, tanpa validasi organisasi user/lokasi.

### Mekanisme kegagalan

Halaman global mengungkap UUID target. Action reset/deactivate kemudian dapat dipanggil terhadap user organisasi lain. Ini tidak memerlukan brute force UUID.

### Rekomendasi

- Terapkan helper `requireSameOrgUser(actor, targetId)` pada semua action.
- Query daftar user/location selalu filter organisasi.
- `setAssignments` harus memvalidasi target user dan seluruh location IDs dalam satu transaksi.
- Pertimbangkan larangan reset/deactivate terhadap role yang setara/lebih tinggi dan perlindungan last-active-admin per organisasi.

### Kriteria penerimaan

- Admin A tidak melihat user/lokasi B.
- Reset, deactivate, dan assignment silang selalu gagal tanpa perubahan parsial.
- Ada test bahwa session B tetap aktif setelah serangan dari admin A.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

Diverifikasi dan ini yang paling berbahaya dari tiga P0: `updateUserProfile`
memang sudah memeriksa `target.orgId === actor.orgId`, tetapi `setUserActive`,
`resetUserPassword`, dan `setAssignments` tidak. Reset password + revoke session
terhadap akun tenant lain = pengambilalihan akun, dan UUID-nya memang terpampang
karena halaman daftar memakai `where: undefined`.

**Perbaikan:**

- Helper `requireSameOrgUser(actor, targetId)` dipasang di `setUserActive`,
  `resetUserPassword`, dan `setAssignments`. Pesannya sengaja "Pengguna tidak
  ditemukan" — jangan konfirmasi keberadaan akun tenant lain.
- `setAssignments` juga memvalidasi SELURUH `locationIds` berada di organisasi
  aktor sebelum transaksi; kalau ada satu yang bukan, tidak ada perubahan
  parsial.
- Halaman `master/pengguna` kini `where: { orgId: user.orgId }` untuk daftar
  akun dan `locationScopeWhere` untuk daftar lokasi.

**Belum:** larangan reset/nonaktifkan terhadap role setara/lebih tinggi dan
proteksi "admin aktif terakhir". Itu kebijakan produk, bukan bug — saya tidak
memutuskannya sendiri. Diusulkan ke user sebagai keputusan terpisah.

---

**PEMUTAKHIRAN 28 Juli 2026 — proteksi akun dipasang (permintaan user).**

- **Peringkat peran**: admin tidak bisa mereset password atau menonaktifkan akun
  yang SETINGKAT atau lebih tinggi (`outranks()` di `authz.ts`). Akun sendiri
  dikecualikan untuk ganti password.
- **Admin aktif terakhir**: menonaktifkan admin terakhir yang masih aktif di
  organisasi ditolak dengan pesan "angkat admin lain dulu" — mencegah organisasi
  terkunci dari sistemnya sendiri dan pemulihan lewat SQL produksi.

Uji murni (peringkat + daftar peran admin) ada di
`tests/unit/authz-proteksi-akun.test.ts`; penegakan di action butuh database
dan masuk utang integration test.

---

## AUTH-04 — AI run/artifact tidak mempunyai boundary organisasi

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** Kebocoran ringkasan, sumber, dan artefak manajemen lintas-tenant

### Bukti

- `prisma/schema.prisma:1415-1450`: `AiRun` tidak mempunyai `orgId`; `userId` juga bukan relasi Prisma ke `User`.
- `prisma/schema.prisma:1455+`: `AiArtifact` tidak mempunyai `orgId`; ID creator/reviewer/approver bukan relasi tenant.
- `src/lib/ai-hub/read-scope.ts`: scope `null` dianggap covered.
- `src/app/(app)/ai/run/[id]/page.tsx:86-121`: run dicari dengan ID, kemudian diperiksa memakai `accessibleLocationIds`.
- `src/app/api/ai-artifact/[id]/excel/route.ts:22-30`: pola identik pada ekspor.
- Beberapa action artefak juga mengandalkan scope lokasi/run, bukan organisasi eksplisit.

### Mekanisme kegagalan

AUTH-01 membuat role cross-location mempunyai `accessible = null`; `scopeCoveredBy(null, scopeIds)` menerima scope tenant lain. Artefak deterministik yang tidak mempunyai run bahkan lebih sulit diturunkan tenant-nya secara konsisten.

### Rekomendasi

- Tambahkan `orgId` wajib ke `AiRun` dan `AiArtifact`, FK ke Organization, serta indeks tenant.
- Tambahkan FK relasional untuk creator/reviewer/approver bila sesuai model.
- Set `orgId` dari session, tidak pernah dari form.
- Semua read/mutate/export memakai `{ id, orgId: actor.orgId }` terlebih dahulu, baru scope lokasi.
- Migrasi backfill harus menolak baris ambigu dan menghasilkan laporan exception.

### Kriteria penerimaan

- ID run/artifact tenant B menghasilkan 404 untuk seluruh role tenant A.
- Artifact tanpa run tetap memiliki tenant yang tidak ambigu.
- Source references juga divalidasi berada dalam tenant yang sama.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, BELUM diperbaiki (butuh migrasi).** (Claude, 28 Juli 2026)

Diverifikasi: `AiRun` (schema baris 1415+) tidak punya `orgId` dan `userId`
hanyalah kolom UUID, bukan relasi. Sama untuk `AiArtifact`.

Sebagian dampaknya sudah surut setelah AUTH-01 diperbaiki: `scopeCoveredBy` kini
bertumpu pada `accessibleLocationIds` yang maknanya "dalam organisasi user", dan
jalur baca AI sudah di-scope sejak DECISIONS 154 (B9, 7 jalur). Tetapi auditor
benar bahwa itu tenancy TURUNAN, bukan eksplisit — artefak tanpa run tetap
ambigu tenant-nya.

**Kenapa belum saya kerjakan sekarang:** ini butuh migrasi schema + backfill
`orgId` untuk baris lama. Backfill hanya deterministik bila setiap run/artefak
bisa ditelusuri ke lokasi/paket; baris dengan scope kosong harus ditolak dan
dilaporkan, bukan ditebak. Itu pekerjaan bermigrasi yang perlu dijalankan
terhadap database nyata — bukan sesuatu yang pantas saya dorong bersama tujuh
perbaikan lain dalam satu commit tanpa akses DB produksi.

**Rencana:** `orgId` wajib + FK Organization + index tenant pada `AiRun` dan
`AiArtifact`; diisi dari session, tidak pernah dari form; read/mutate/export
memakai `{ id, orgId }` lebih dulu, baru scope lokasi. Migrasi disertai query
laporan pengecualian sebelum constraint dinyalakan.

---

**PEMUTAKHIRAN 28 Juli 2026 — TIDAK BERLAKU pada model deployment yang dipilih.**

User menetapkan model: **satu instalasi = satu organisasi = satu database**
(tiap klien — Pemkab Lamongan, KKP, Gibaku, Pemkab Banyuwangi — mendapat service
Railway dan database sendiri). Dengan begitu tidak ada tenant kedua di dalam satu
database, sehingga `orgId` pada `AiRun`/`AiArtifact` tidak diperlukan sebagai
batas tenant.

Yang TETAP berlaku dari temuan ini dan sudah ditutup: scope lokasi pada jalur
baca/ekspor AI (DECISIONS 154 B9) — itu membatasi ANTAR-PENGGUNA di dalam satu
organisasi, bukan antar-tenant.

Syarat yang harus dipegang: **jangan pernah mengarahkan dua klien ke database
yang sama.** Bila kelak modelnya berubah, temuan ini hidup kembali sebagai P0.

---

## AUTH-05 — Route PDF melewati capability `report.export`

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Temuan baru/ambiguity permission model
**Dampak:** Pengguna yang boleh melihat lokasi dapat mengekspor dokumen walau capability tidak diberikan

### Bukti

Ketiga route hanya memeriksa session dan `hasLocationAccess()`:

- `src/app/api/laporan/harian/[slug]/[date]/pdf/route.ts:14-18`
- `src/app/api/laporan/periodik/[slug]/[kind]/[n]/pdf/route.ts:20-24`
- `src/app/api/kegiatan/[id]/pdf/route.ts:19-23`

Tidak ada pemeriksaan `report.export`, meskipun capability tersebut ada di permission matrix.

### Analisis

Jika PDF dianggap sekadar “view representation”, nama capability perlu diperjelas dan seluruh UI harus konsisten. Jika PDF adalah export, route ini adalah bypass. Direct GET tetap dapat dilakukan walau tombol disembunyikan.

### Rekomendasi

- Putuskan definisi `report.view` versus `report.export`.
- Jika download adalah export, gunakan `requireCapability("report.export")` plus location scope.
- Tambahkan negative route tests per role.
- Terapkan `Content-Disposition` dan logging download sesuai klasifikasi dokumen.

### Kriteria penerimaan

- Permission matrix dan perilaku direct URL identik.
- Field role tanpa export menerima 403/404 pada ketiga route.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

**Definisi produk yang saya ambil:** mengunduh PDF adalah **EKSPOR**, bukan
sekadar melihat. Alasannya: berkas itu keluar dari aplikasi, disetor ke Drive,
dikirim via WhatsApp, dan menjadi dokumen resmi. `report.view` untuk melihat di
layar, `report.export` untuk mendapat berkasnya.

**Perbaikan:** ketiga route (`harian`, `periodik`, `kegiatan`) kini menegakkan
`can(user.role, "report.export")` → 403 bila tidak punya, di ATAS pemeriksaan
akses lokasi yang sudah ada. Direct GET tidak lagi menembus tombol yang
disembunyikan.

**Catatan:** matriks permission tidak diubah, hanya ditegakkan. Kalau ternyata
ada role lapangan yang secara operasional butuh mengunduh PDF tetapi tidak punya
`report.export`, itu keputusan matriks — bukan alasan melonggarkan route.

---

## CALC-01 — Snapshot final historis memakai progres/revisi/baseline saat ini

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Temuan baru, berkaitan dengan open issue `getLocationProgress` tanpa `asOf`
**Dampak:** Dokumen resmi historis dapat menyimpan angka masa depan

### Bukti

- `src/lib/daily-report/service.ts:464-470`:
  - `cumulativeVolumeByLineage(locationId, reportDate)` benar-benar as-of tanggal laporan.
  - `getLocationProgress(locationId)` tidak menerima tanggal.
- `src/lib/progress.ts:96-119`: query realized mengambil semua laporan counted tanpa filter `reportDate`.
- `src/lib/progress.ts:122-143`: revisi aktif dan baseline aktif saat pemanggilan digunakan.
- `src/lib/progress.ts:129-131`: minggu rencana dihitung dengan `new Date()` implisit.
- `src/lib/daily-report/service.ts:523-529`: hasil current-state tersebut dibekukan ke `finalSnapshot.progress`.

### Contoh

Laporan 1 Juli baru difinalkan 20 Juli. Pada 2–20 Juli sudah ada banyak laporan counted dan mungkin adendum RAB/baseline baru. Detail item snapshot 1 Juli benar sampai 1 Juli, tetapi header progress-nya dapat mencerminkan realisasi 20 Juli, bobot revisi baru, dan plan minggu 20 Juli.

### Rekomendasi

Buat API eksplisit:

```ts
getLocationProgressAt({
  locationId,
  asOfDate,
  rabRevisionId,
  baselineId,
})
```

Definisikan aturan versi:

- RAB/baseline yang efektif pada `reportDate`; atau
- RAB/baseline yang direferensikan laporan ketika dibuat.

Jangan memilih “aktif saat finalisasi”. Simpan revision/baseline reference pada report/snapshot agar keputusan dapat diaudit.

### Kriteria penerimaan

- Menambah laporan tanggal berikutnya tidak mengubah snapshot yang dibangun untuk tanggal lama.
- Mengganti RAB/baseline setelah tanggal laporan tidak mengubah hasil historis.
- Finalisasi terlambat menghasilkan angka sama dengan finalisasi pada tanggal laporan.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, BELUM diperbaiki (butuh keputusan bisnis).** (Claude, 28 Juli 2026)

Diverifikasi dan ini temuan angka paling serius di dokumen ini. Benar:
`cumulativeVolumeByLineage(locationId, reportDate)` as-of tanggal laporan,
tetapi `getLocationProgress(locationId)` tidak menerima tanggal — ia memakai
laporan counted SAAT INI, revisi aktif SAAT INI, baseline aktif SAAT INI, dan
minggu berjalan dari jam dinding. Hasil itu lalu dibekukan ke
`finalSnapshot.progress`. Contoh auditor (laporan 1 Juli difinalkan 20 Juli)
sahih.

**Kenapa belum saya kerjakan:** pertanyaan intinya bukan teknis melainkan
bisnis, dan auditor benar menaruhnya sebagai pertanyaan: **angka progress di
blanko harian itu "posisi per tanggal laporan" atau "posisi saat dokumen
difinalkan"?** Keduanya bisa dipertahankan secara hukum kontrak, dan pilihannya
mengubah arti setiap dokumen historis yang sudah final. Saya tidak boleh memilih
diam-diam — persis kesalahan yang sudah saya lakukan di sesi ini ketika mengunci
baris rencana Excel tanpa bertanya.

**Rekomendasi saya:** as-of tanggal laporan (opsi pertama). Dokumen harian
adalah potret hari itu; finalisasi terlambat seharusnya tidak mengubah isinya.
Konsekuensinya `getLocationProgressAt({ locationId, asOfDate, rabRevisionId,
baselineId })` + menyimpan referensi revisi/baseline di laporan agar keputusan
dapat diaudit.

**Menunggu keputusan user.** Setelah itu: golden test "menambah laporan tanggal
berikutnya tidak mengubah snapshot tanggal lama".

---

**PEMUTAKHIRAN 28 Juli 2026 — sudah dikerjakan.** User memutuskan: **as-of
tanggal laporan** (data produksi masih sedikit, jadi diubah sekarang sebelum
menumpuk).

`getLocationsProgress(ids, { asOf })` ditambahkan:

- realisasi hanya dari laporan counted dengan `report_date <= asOf`;
- revisi RAB & baseline yang dipakai adalah yang EFEKTIF pada tanggal itu
  (`createdAt <= asOf` dan belum digantikan saat itu), bukan yang aktif sekarang;
- minggu rencana dihitung terhadap `asOf`, bukan jam dinding.

`finalSnapshot` laporan harian memanggilnya dengan `asOf: report.reportDate`.
Tanpa `asOf` perilakunya tidak berubah — dashboard dan halaman progress tetap
menampilkan posisi terkini, sebagaimana mestinya.

Utang: golden test "menambah laporan tanggal berikutnya tidak mengubah snapshot
tanggal lama" butuh PostgreSQL, dijalankan di CI.

---

## CALC-02 — Submit laporan paralel dapat melampaui volume RAB

**Prioritas:** P1 / Tinggi
**Keyakinan:** Sedang-Tinggi
**Status:** Risiko concurrency; perlu reproduction test PostgreSQL
**Dampak:** Realisasi counted dapat melebihi volume kontrak

### Bukti

- `src/lib/daily-report/service.ts:274-318`: guard membaca agregat laporan lain.
- `src/lib/daily-report/service.ts:333-353`: transaksi kemudian mengubah status report.
- Optimistic condition `where: { id, status }` hanya melindungi **report yang sama**.
- Tidak ada row lock, advisory lock, atau isolation `Serializable` pada resource bersama (location/lineage/RAB node).
- `src/lib/finance/apply.ts:8-16, 31, 70` menjelaskan race aggregate→guard→create pada isolation default dan memperbaikinya dengan `FOR UPDATE`.

### Interleaving

```text
RAB tersisa 10
T1 membaca laporan lain = 0; laporan A = 10 → lolos
T2 membaca laporan lain = 0; laporan B = 10 → lolos
T1 status A → dikirim; commit
T2 status B → dikirim; commit
Total counted = 20
```

Karena A dan B adalah baris report berbeda, optimistic lock keduanya berhasil.

### Rekomendasi

- Lock resource yang konsisten per lokasi atau per `(locationId, lineageKey)` sebelum agregasi.
- Alternatif: transaction `Serializable` dengan retry yang teruji, tetapi row/advisory lock biasanya lebih terarah.
- Tambahkan integration race test dua report pada lineage yang sama, serupa `finance-race.test.ts`.
- Jangan hanya clamp progres 100%; overshoot harus tetap ditolak dan terlihat.

### Kriteria penerimaan

- Dari dua submit paralel yang bersama-sama melebihi RAB, tepat satu commit.
- Request kalah mendapat pesan koreksi yang dapat ditindaklanjuti.
- Test dijalankan berulang untuk mendeteksi flaky race.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

Ini menambal lubang di perbaikan saya sendiri. DECISIONS 154 (B1) memindahkan
validasi volume KE DALAM transaksi transisi `→ dikirim`, dan itu menutup kasus
berurutan (dua draft, dua tanggal). Auditor benar bahwa kasus benar-benar
paralel masih lolos: `where: { id, status }` hanya optimistic lock untuk BARIS
YANG SAMA, sedangkan dua laporan berbeda pada lokasi yang sama membaca agregat
yang sama-sama belum ter-commit.

**Perbaikan:** `pg_advisory_xact_lock(hashtextextended(locationId, 0))` diambil
di awal transaksi sebelum agregasi, sehingga submit bersamaan pada satu lokasi
antre — pola sekeluarga dengan `SELECT … FOR UPDATE` di `finance/apply.ts`.
Lock per LOKASI (bukan per lineage) dipilih karena guard membaca lintas-lineage
dan biaya kontensinya rendah: submit harian per lokasi jarang bersamaan.

**Belum:** integration race test dua submit paralel seperti `finance-race.test.ts`.
Lingkungan kerja ini tanpa PostgreSQL, jadi test yang tidak bisa saya jalankan
tidak saya klaim hijau. Ini pekerjaan berikutnya dan saya catat sebagai utang.

---

## CALC-03 — Formula `grandTotal` periodik bercabang dari formula kanonik

**Prioritas:** P2 / Sedang
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** Dashboard dan laporan periodik dapat berbeda pada RAB malformed/categoryless

### Bukti

- `PROJECT.md` dan `src/lib/progress.ts:76-84`: `grandTotal = Σ amount kategori`.
- `src/lib/periodic-report.ts:317-322`: bila sum kategori nol, fallback ke sum item; bila keduanya nol, fallback ke `1`.

### Analisis

Fallback menghindari pembagian nol, tetapi mengubah definisi bisnis diam-diam. RAB tanpa kategori menampilkan total 0 di dashboard dan total item di laporan periodik. Nilai `1` juga merupakan sentinel teknis yang dapat masuk ke persentase.

### Rekomendasi

- Pusatkan fungsi `grandTotal` dalam calculation layer.
- RAB tanpa kategori/total nol sebaiknya menjadi readiness/data-quality error, bukan formula alternatif.
- Gunakan nullable/not-calculable state untuk denominator nol.

### Kriteria penerimaan

- Dashboard, laporan, PDF, Excel, dan AI memakai nilai identik untuk fixture categoryless/zero.
- Data invalid tampil sebagai invalid, bukan denominator buatan.

### Tanggapan / Tantangan Balik

**Status: DITERIMA SEBAGIAN — sentinel dibuang, fallback dipertahankan.** (Claude, 28 Juli 2026)

Benar bahwa `grandTotal = … : sumItem > 0 ? sumItem : 1` menyimpang dari formula
kanonik, dan sentinel `1` adalah yang paling berbahaya: ia membuat persentase
tampak wajar padahal datanya kosong.

**Perbaikan:** sentinel `1` dibuang → `sumKategori > 0 ? sumKategori : sumItem`.
Pembagi nol sudah ditangani di layer kanonik: `bobotPct()` mengembalikan 0 saat
`grandTotal <= 0` (`progress-calc.ts:81-85`), jadi RAB kosong kini menampilkan 0
di laporan periodik — SAMA dengan dashboard.

**Yang saya pertahankan:** fallback ke Σ item untuk RAB tanpa baris kategori.
Alasannya, impor RAB tidak menjamin setiap file punya baris kategori, dan
menampilkan 0 untuk RAB yang jelas berisi item akan lebih menyesatkan bagi
pengguna lapangan daripada memakai Σ item. Saya setuju idealnya ini menjadi
readiness/data-quality error, tetapi itu perubahan perilaku produk — keputusan
user, bukan saya.

---

## CALC-04 — Generator baseline mengunci kategori berdasarkan nama, bukan lineage

**Prioritas:** P2 / Sedang
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** Kategori bernama sama dapat digabung atau mendapat jadwal yang salah

### Bukti

- `src/lib/scurve/sequencing.ts:494-551`: `SchedItem` hanya membawa `categoryName`; seluruh `Map` di-key dengan nama.
- `src/lib/rab/import.ts:237-245`: lineage item dipetakan menjadi nama kategori dan identitas lineage dibuang.
- `src/lib/rab/import.ts:251-275`: `catWindowWeeks` dan `weeklyByName` juga di-key dengan `c.name`.
- Schema mengidentifikasi node dengan `lineageKey`; nama bukan unique key.

### Skenario

Dua unit “Bangunan Pos” atau dua kategori “Pekerjaan Persiapan” memiliki lineage berbeda. Generator menggabungkan item keduanya sebagai satu kategori. Ketika hasil dipetakan kembali, kedua baris dapat menerima profil mingguan gabungan/sama, sementara bobot output tetap dihitung per baris.

### Rekomendasi

- Ubah input menjadi `{ categoryKey: lineageKey, categoryName }`.
- Semua map menggunakan `categoryKey`; nama hanya untuk klasifikasi dan label.
- Tambahkan fixture duplicate-name dengan lineage berbeda dan assert total bobot/kurva.

### Kriteria penerimaan

- Mengganti nama kategori tidak mengubah identitas schedule.
- Dua kategori bernama sama tetap menghasilkan dua schedule independen.
- Jumlah weekly seluruh kategori sama dengan kurva agregat dan berakhir 100%.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, BELUM diperbaiki.** (Claude, 28 Juli 2026)

Benar: `SchedItem` hanya membawa `categoryName` dan seluruh `Map` di mesin
sequencing di-key dengan nama, sedangkan schema mengidentifikasi node dengan
`lineageKey`. Saya tidak punya bukti tandingan bahwa nama kategori unik — tidak
ada constraint yang menjaminnya, dan impor RAB tidak menolak nama kembar.

**Catatan pembatas dampak (bukan pembelaan):** dua kategori bernama sama pada
SATU revisi RAB memang belum pernah terlihat di 15 RAB korpus uji, dan bobot
output tetap dihitung per baris sehingga total kurva tidak bergeser — yang
salah adalah BENTUK jadwal keduanya menjadi identik. Jadi ini merusak jadwal,
bukan angka bobot.

**Rencana:** ubah input menjadi `{ categoryKey: lineageKey, categoryName }`,
semua map memakai `categoryKey`, nama hanya untuk klasifikasi dan label; plus
fixture duplicate-name dengan lineage berbeda. Belum dikerjakan di commit ini
supaya perubahan mesin penjadwalan tidak bercampur dengan perbaikan otorisasi —
mesin itu punya 400+ baris uji korpus yang perlu dievaluasi ulang.

---

## DATA-01 — Integritas tenant antar-entitas tidak dijaga database

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Temuan arsitektural
**Dampak:** Relasi silang organisasi dan data mustahil tetap dapat tersimpan

### Bukti

Schema memiliki tenant pada beberapa root, tetapi relasi tidak membawa composite tenant key:

- `Contract` mengacu ke `Package` dan `Vendor`; database tidak membuktikan `package.orgId = vendor.orgId`.
- `LocationAssignment` mengacu ke `User` dan `Location`; tidak ada constraint kesamaan organisasi.
- `Document.orgId` dapat berbeda dari organisasi package/location yang direferensikan.
- Model lain mengandalkan organisasi secara transitif atau tidak memilikinya.
- Migration memiliki append-only trigger, tetapi pencarian `CHECK (` tidak menemukan semantic check untuk nilai/relasi penting.

### Risiko semantik tambahan

Constraint database juga belum menjaga contoh berikut:

- jumlah uang/volume non-negatif pada jalur yang relevan;
- retensi tidak melebihi nilai termin;
- tanggal akhir tidak sebelum tanggal mulai;
- lat/lng dalam rentang;
- foto tepat memiliki salah satu parent report/activity.

Validasi aplikasi membantu, tetapi bug, script, migration, atau jalur action yang terlewat tetap dapat menyimpan state mustahil.

### Rekomendasi

- Definisikan tenant root setiap tabel.
- Untuk relasi kritis, gunakan composite unique/FK yang menyertakan `orgId`, atau trigger constraint teruji.
- Tambahkan `CHECK` untuk invariant lokal yang stabil.
- Lakukan migration preflight untuk mencari data yang sudah melanggar.
- Pertimbangkan PostgreSQL RLS sebagai defense-in-depth setelah application scoping benar; jangan menjadikan RLS pengganti authorization domain.

### Kriteria penerimaan

- Database menolak kontrak/vendor lintas-org dan assignment silang walaupun raw SQL dipakai.
- Constraint test mencakup setiap invariant penting.
- Migration mempunyai query laporan exception sebelum constraint diaktifkan.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, BELUM diperbaiki.** (Claude, 28 Juli 2026)

Benar bahwa tidak ada composite FK/CHECK yang menjaga `package.orgId =
vendor.orgId`, `LocationAssignment` sekelompok organisasi, atau invariant lokal
(uang/volume non-negatif, tanggal akhir ≥ mulai, lat/lng, foto XOR parent).

**Yang berubah hari ini:** jalur APLIKASI untuk kontrak-vendor dan
assignment-lokasi sudah ditutup (AUTH-02, AUTH-03). Auditor benar itu belum
cukup: script, migrasi, atau action yang terlewat tetap bisa menulis state
mustahil.

**Kenapa belum:** menyalakan constraint pada database yang sudah berisi data
menuntut preflight — query laporan pelanggaran dulu, bersihkan, baru
`ALTER TABLE`. Tanpa akses database nyata, menulis migrasinya sekarang berarti
menebak apakah datanya lolos. Itu cara membuat deploy gagal di tengah malam.

**Rencana bertahap:** (1) query preflight untuk tiap invariant; (2) CHECK untuk
invariant lokal yang jelas aman (non-negatif, rentang tanggal, lat/lng);
(3) composite unique/FK ber-`orgId` untuk relasi kritis; (4) RLS hanya sebagai
defense-in-depth SETELAH scoping aplikasi benar — bukan penggantinya.

---

**PEMUTAKHIRAN 28 Juli 2026 — dipecah menurut model deployment.**

Bagian **tenant** (composite FK ber-`orgId`, larangan kontrak/vendor lintas-org)
TIDAK BERLAKU: satu database hanya berisi satu organisasi.

Bagian **invariant lokal TETAP BERLAKU dan tetap utang**, karena tidak ada
hubungannya dengan tenancy: jumlah uang/volume non-negatif, retensi ≤ nilai
termin, tanggal akhir ≥ tanggal mulai, lat/lng dalam rentang, dan foto tepat
punya salah satu parent (report XOR activity). Ini yang akan dikerjakan dari
temuan DATA-01, dengan query preflight lebih dulu.

---

## DATA-02 — Setting, audit, dan sebagian data domain bersifat global

**Prioritas:** P2 / Sedang; naik menjadi P0 bila multi-org aktif
**Keyakinan:** Tinggi
**Status:** Temuan arsitektural
**Dampak:** Konfigurasi/secret bersama dan audit sulit dipisahkan per tenant

### Bukti

- `prisma/schema.prisma:1291-1306`: `AuditLog` tidak memiliki `orgId`.
- `prisma/schema.prisma:1326-1334`: `AppSetting` unik hanya atas `(key, effectiveFrom)`.
- Branding, konfigurasi WAHA, photo stamp, dan sebagian konfigurasi AI dibaca sebagai setting global.
- `src/app/(app)/sistem/page.tsx:119-167`: audit log, session count, user count, role count, dan WA message terakhir dibaca global; hanya maintenance locations yang difilter org.

### Analisis

Jika tenant berbeda membutuhkan kredensial WAHA/AI, branding, kebijakan foto, atau audit terpisah, model sekarang tidak dapat merepresentasikannya dengan aman. Audit tanpa `orgId` bergantung pada user nullable dan resource ID generik.

### Rekomendasi

- Tambahkan `orgId` ke setting yang bersifat tenant; pisahkan setting global platform secara eksplisit.
- Tambahkan `orgId` snapshot wajib ke audit log, termasuk event system/user-null.
- Filter halaman sistem dan metrik per organisasi.
- Secret sebaiknya berada di secret store/env per deployment atau terenkripsi, bukan value database biasa tanpa model ownership.

### Kriteria penerimaan

- Admin A tidak melihat statistik/log/config B.
- Setiap audit event dapat dipetakan ke tenant tanpa join yang ambigu.
- Ada klasifikasi tertulis: platform-global vs tenant-local.

### Tanggapan / Tantangan Balik

**Status: DITERIMA sebagai arsitektur; prioritas bergantung keputusan tenancy.** (Claude, 28 Juli 2026)

Benar: `AuditLog` tanpa `orgId`, `AppSetting` unik hanya atas `(key,
effectiveFrom)`, dan halaman `/sistem` membaca metrik global.

**Klasifikasi yang saya usulkan** (auditor benar bahwa ini harus tertulis):

- **Platform-global** (satu deployment, satu nilai): branding aplikasi,
  konfigurasi photo stamp, kill-switch AI, batas kuota.
- **Tenant-local** (harus ber-`orgId` bila multi-org): kredensial WAHA, folder
  Google Drive, kop/logo pemilik pekerjaan, kebijakan approval.
- **Audit**: `orgId` snapshot wajib, termasuk event tanpa user.

**Model deployment saat ini:** satu database, satu organisasi. Selama itu benar,
temuan ini P2. Begitu organisasi kedua masuk, ia naik P0 — dan menambah `orgId`
setelah data menumpuk jauh lebih mahal. Karena itu saya setuju ini dikerjakan
SEBELUM organisasi kedua, bukan sesudah.

---

**PEMUTAKHIRAN 28 Juli 2026 — TIDAK BERLAKU sebagai isu tenancy.**

Karena satu database = satu organisasi, "global" dan "tenant-local" berimpit:
branding, kredensial WAHA, folder Drive, dan audit log memang milik satu
organisasi itu. Klasifikasi yang saya usulkan di atas tetap berguna sebagai
dokumentasi, tetapi tidak ada pekerjaan `orgId` yang perlu dikerjakan.

Yang tersisa dari temuan ini dan tetap valid: **secret sebaiknya di environment
variable, bukan baris database biasa** — itu soal pengelolaan rahasia, bukan
tenancy.

---

## STORE-01 — Dedup foto global dan upload tidak atomik dengan metadata

**Prioritas:** P2 / Sedang
**Keyakinan:** Sedang-Tinggi
**Status:** Temuan baru
**Dampak:** Penolakan bukti sah lintas lokasi dan orphan object di R2

### Bukti

- `prisma/schema.prisma:980-1005`: `Photo.sha256 @unique` global, tanpa `orgId`/`locationId`.
- `src/lib/photos.ts:224-239`: dedup mencari hash global.
- Pipeline melakukan transform/upload object sebelum row database selesai dibuat; R2 dan PostgreSQL tidak berbagi transaksi.
- Schema mengizinkan `reportId` dan `activityId` keduanya null atau keduanya terisi; komentar aplikasi saja yang menyatakan salah satu wajib.

### Analisis

Foto byte-identik yang sah dipakai pada dua lokasi/organisasi ditolak. Sebaliknya, kegagalan create row setelah upload dapat meninggalkan object tanpa metadata. Concurrency upload hash sama juga bergantung pada unique violation setelah pekerjaan R2 terlanjur dilakukan.

### Rekomendasi

- Scope dedup sesuai keputusan bisnis: per organisasi, lokasi, atau parent; simpan `orgId/locationId` eksplisit bila perlu.
- Tangani unique conflict secara idempotent.
- Pada kegagalan DB, enqueue cleanup object atau gunakan status upload pending/finalized.
- Tambahkan DB `CHECK` XOR parent.
- Sediakan reconciliation job untuk object R2 yatim dan row dengan object hilang.

### Kriteria penerimaan

- Bukti identik pada scope yang diizinkan dapat disimpan.
- Tidak ada orphan permanen setelah simulasi DB failure.
- Database menolak parent invalid.

### Tanggapan / Tantangan Balik

**Status: DITERIMA sebagian.** (Claude, 28 Juli 2026)

- **Dedup global — benar dan nyata.** `Photo.sha256 @unique` global berarti foto
  byte-identik yang sah (mis. papan nama tipikal, dokumen yang sama difoto di
  dua lokasi) ditolak di lokasi kedua. Ini bug produk, bukan sekadar hardening.
  Perbaikan yang saya usulkan: unique `(locationId, sha256)`, bukan per
  organisasi — dedup yang berguna bagi mandor adalah "jangan kirim foto yang
  sama dua kali di lokasi ini".
- **Upload tidak atomik — benar, risikonya orphan object di R2**, bukan
  kehilangan data. Mitigasi murah: tandai baris `pending` sebelum upload lalu
  `finalized`, plus job rekonsiliasi. Belum dikerjakan.
- **XOR parent — benar**, schema mengizinkan `reportId` dan `activityId`
  dua-duanya null/terisi. Kandidat CHECK paling aman untuk dikerjakan lebih dulu
  (lihat DATA-01).

Belum diperbaiki di commit ini: ketiganya menyentuh migrasi + pipeline foto, dan
saya memilih tidak mencampurnya dengan perbaikan otorisasi.

---

## AUDIT-01 — Audit log best-effort dan tidak atomik dengan mutasi

**Prioritas:** P2 / Sedang
**Keyakinan:** Tinggi
**Status:** Trade-off eksplisit yang perlu diterima atau diubah
**Dampak:** Perubahan bisnis sukses tanpa jejak audit

### Bukti

- `src/lib/audit.ts:5-8`: komentar menyatakan kegagalan audit tidak boleh menggagalkan aksi.
- `src/lib/audit.ts:16-29`: insert terpisah dibungkus `try/catch`; error hanya ke console.
- Banyak action commit transaksi domain terlebih dahulu, lalu memanggil `audit()` di luar transaksi.

### Analisis

Trigger append-only melindungi log yang sudah ada, tetapi tidak menjamin log selalu tercipta. Pada outage parsial, pool exhaustion, bug payload, atau request termination sesudah commit, mutasi tidak memiliki audit.

### Rekomendasi

Pilih tingkat assurance secara eksplisit:

- Mutasi bernilai tinggi: domain update dan audit event dalam transaksi yang sama; atau transactional outbox wajib.
- Event non-kritis: best-effort boleh, tetapi harus ada metric/alert/dead-letter, bukan hanya console.
- Audit event menyimpan tenant, correlation/request ID, actor, before/after minimal, dan outcome.

### Kriteria penerimaan

- Fault injection pada penulisan audit tidak menghasilkan mutasi penting tanpa event yang akhirnya tersimpan.
- Kegagalan audit terlihat di monitoring dan mempunyai retry path.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, belum diperbaiki.** (Claude, 28 Juli 2026)

Benar bahwa `audit()` dipanggil di luar transaksi mutasi, jadi mutasi bisa
berhasil tanpa jejak bila proses mati di antaranya, dan kegagalan audit tidak
membatalkan mutasi.

Yang tidak saya sepakati adalah menaikkannya di atas temuan angka: audit di sini
adalah jejak internal, bukan pengendali keputusan bisnis. Prioritas P2 sudah
tepat.

**Rencana:** pindahkan penulisan audit KE DALAM transaksi untuk mutasi
berdampak-uang/status (keuangan, transisi laporan, kontrak), dan pertahankan
best-effort untuk yang lain. Tambahkan `orgId` snapshot sekalian (DATA-02).

---

## SEC-01 — Health endpoint publik mengembalikan pesan error database mentah

**Prioritas:** P2 / Sedang
**Keyakinan:** Tinggi
**Status:** Temuan baru
**Dampak:** Information disclosure

### Bukti

`src/app/api/health/route.ts:11-14` mengembalikan `err.message` ke client saat query DB gagal. Endpoint health digunakan oleh platform dan tidak memerlukan session.

### Risiko

Error driver dapat memuat hostname, database name, detail TLS, timeout, atau struktur koneksi. Walau tidak selalu mengandung password, informasi ini membantu reconnaissance dan tidak dibutuhkan health checker.

### Rekomendasi

- Response publik: `{ status: "error", db: "down", code: "DB_UNAVAILABLE" }`.
- Log detail server-side dengan correlation ID dan redaction.
- Pisahkan liveness (proses hidup) dari readiness (dependency siap) bila platform mendukung.

### Kriteria penerimaan

- Simulasi connection error tidak membocorkan message/stack/host.
- Operator tetap dapat menemukan detail melalui log terautentikasi.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, sudah diperbaiki.** (Claude, 28 Juli 2026)

`/api/health` memang mengembalikan `err.message` mentah ke publik; pada
kegagalan koneksi, pesan Prisma/pg bisa memuat host, nama database, bahkan
kredensial di URL.

**Perbaikan:** respons publik kini hanya `{ status, db: "down", timestamp }`
dengan HTTP 503; detail error ditulis ke log server (`console.error`) supaya
operator tetap bisa mendiagnosa. Healthcheck Railway hanya membaca status code,
jadi tidak ada yang rusak.

---

## SUPPLY-01 — Empat advisory moderat masih ada di dependency production tree

**Prioritas:** P2 / Sedang
**Keyakinan:** Tinggi untuk keberadaan; dampak exploit tergantung reachability
**Status:** Perlu triage dependency
**Dampak:** Risiko transitif dan drift dari catatan keamanan

### Bukti verifikasi `pnpm audit --prod --json`

1. `@hono/node-server@1.19.11` melalui Prisma optional dependency:
   - GHSA-92pp-h63x-v22m, middleware bypass repeated slash.
   - GHSA-frvp-7c67-39w9, path traversal Windows encoded backslash.
2. `uuid@8.3.2` melalui `exceljs`:
   - GHSA-w5hq-g745-h8pq, missing buffer bounds check ketika buffer diberikan.
3. `valibot@1.2.0` melalui Prisma optional dependency:
   - GHSA-5qjj-4xww-7phc, crafted record path dapat membuat flatten throw.

Output ringkas juga menyebut satu high yang di-ignore. `pnpm-workspace.yaml:15-20` mendokumentasikan ignore GHSA brace-expansion karena instance v5 sudah dipatch dan scanner ikut menandai lini v1/v2 yang sudah patched. Penjelasan ignore tersebut masuk akal, tetapi harus terus diverifikasi pada lockfile.

### Analisis reachability

- Advisory Hono/Valibot berada pada tooling/optional chain Prisma dan kemungkinan tidak masuk request runtime aplikasi.
- Advisory uuid berada dalam ExcelJS; fungsi rentan spesifik terhadap API UUID dengan buffer, bukan penggunaan workbook normal.
- Karena perintah memakai `--prod`, klasifikasi dependency Prisma yang menarik tooling optional ke production tree perlu ditinjau.

### Rekomendasi

- Update Prisma/ExcelJS/transitive packages ketika versi kompatibel tersedia.
- Catat reachability per advisory, owner, expiry date, dan versi patched.
- Verifikasi lockfile setelah setiap update; jangan hanya mengandalkan summary severity.
- Sinkronkan `OPEN_ISSUES.md`, yang masih menyebut tiga moderate transitive dev deps.

### Kriteria penerimaan

- Audit 0 high/critical tanpa ignore yang tidak terdokumentasi.
- Setiap moderate mempunyai reachability decision bertanggal.
- Dokumentasi jumlah/severity sesuai lockfile aktual.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar, diverifikasi ulang hari ini.** (Claude, 28 Juli 2026)

`pnpm audit --prod` pada commit ini: **4 moderate + 1 high (1 ignored)**. Salah
satunya `valibot <=1.4.1` yang masuk lewat rantai
`@prisma/client > prisma > @prisma/dev` — yaitu dependensi perkakas Prisma yang
ikut terbawa ke pohon production.

**Penilaian saya soal reachability:** jalur `@prisma/dev` tidak dieksekusi oleh
runtime aplikasi (ia dipakai CLI Prisma), jadi risiko eksploitasinya rendah —
tetapi "rendah" bukan "nol", dan auditor benar bahwa keberadaannya tetap harus
ditutup. Perbaikannya bukan di kode kita melainkan menunggu/menaikkan versi
Prisma; stack di-pin ketat (TECHNOLOGY_AUDIT), jadi kenaikan versi harus
diverifikasi terhadap Prisma 7 + adapter-pg.

**Rencana:** cek rilis Prisma yang menaikkan `@prisma/dev`, uji di branch
terpisah, jangan ditambal lewat `overrides` yang menyembunyikan masalah.

---

## CI-01 — Push langsung ke `dev` tidak menjalankan CI

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Temuan baru/documentation drift
**Dampak:** Commit pada branch audit dapat masuk tanpa gate otomatis

### Bukti

- `.github/workflows/ci.yml:3-6`: trigger push hanya `branches: [main]`; PR tetap memicu CI.
- `docs/rebuild/TEST_PLAN.md:21`: menyatakan empat job berjalan pada push ke `main`/`dev` dan PR.
- Branch yang diminta/diaudit adalah `dev`.

### Analisis

Jika semua perubahan ke `dev` wajib lewat PR, PR checks masih bekerja, tetapi direct push ke `dev` tidak. Dokumentasi menyatakan sebaliknya, sehingga operator dapat mengira commit dev sudah diverifikasi.

### Rekomendasi

- Tambahkan `dev` ke push branches, atau enforce branch protection yang melarang direct push dan perbarui dokumentasi.
- Jadikan checks required untuk branch utama pengembangan.
- Tambahkan concurrency comment yang sesuai branch sebenarnya.

### Kriteria penerimaan

- Commit push ke `dev` memicu seluruh job, atau direct push mustahil oleh rule.
- TEST_PLAN dan workflow identik.

### Tanggapan / Tantangan Balik

**Status: DITERIMA SEBAGIAN — faktanya benar, tetapi bukan tanpa CI.** (Claude, 28 Juli 2026)

Benar: `.github/workflows` hanya memicu pada `push: branches: [main]` dan
`pull_request`. Push langsung ke `dev` tidak memicu workflow **push**.

**Yang perlu diluruskan:** selama ada PR terbuka dari `dev` (kondisi kerja
normal repo ini — PR #106 lalu #107), setiap push ke `dev` MEMICU CI lewat
event `pull_request`. Sepanjang sesi ini keempat job memang berjalan pada tiap
push ke `dev` dan sempat menangkap kegagalan nyata. Jadi "push ke dev tidak
menjalankan CI" hanya benar ketika TIDAK ada PR terbuka.

**Konteks keputusan:** memicu pada push-ke-dev pernah dicoba dan sengaja
ditolak (DECISIONS 153, M10) karena menghasilkan run ganda dan pembatalan
beruntun untuk commit yang sama.

**Yang saya sepakati:** celahnya nyata pada periode `dev` tanpa PR terbuka.
Perbaikan yang tidak menimbulkan run ganda: tambahkan `push: branches: [dev]`
DENGAN `concurrency` per-ref yang sudah ada, atau tegakkan aturan bahwa `dev`
selalu punya PR terbuka ke `main`. Saya usulkan yang pertama; menunggu
persetujuan karena ini menyentuh perilaku CI yang sudah pernah diputuskan.

---

**PEMUTAKHIRAN 28 Juli 2026 — keputusan user: JALANKAN SEPERTI SEKARANG.**

Pemicu `push: branches: [dev]` tidak ditambahkan. Konsekuensi yang diterima:
selama `dev` tidak punya PR terbuka ke `main`, push ke `dev` tidak menjalankan
CI. Dalam praktik kerja repo ini `dev` hampir selalu punya PR terbuka, jadi
celahnya sempit.

Saran yang tetap saya sampaikan dan belum dikerjakan karena butuh akses setelan
GitHub (bukan kode): nyalakan **branch protection** pada `main` — wajib PR dan
wajib seluruh check hijau sebelum merge.

---

## TEST-01 — Jalur bisnis dan isolasi paling kritis belum tertutup test

**Prioritas:** P1 / Tinggi
**Keyakinan:** Tinggi
**Status:** Sebagian sudah diakui TEST_PLAN/OPEN_ISSUES
**Dampak:** Regresi authorization dan angka resmi tidak tertangkap

### Bukti

- Terdapat 36 file unit, 5 integration, dan 1 E2E.
- Unit test lulus 428 test, tetapi dominan pure functions/helper.
- E2E yang ada berfokus pada autentikasi, bukan workflow RAB → laporan → verifikasi → progress → PDF/Excel.
- Tidak ditemukan fixture dua organisasi yang menyerang cross-tenant access.
- Tidak ada integration race test submit laporan; finance race test sudah ada.
- Belum ada golden parity test yang membandingkan dashboard, laporan harian, laporan periodik, PDF, Excel, dan sumber AI pada fixture yang sama.

### Rekomendasi minimum

1. **Tenant matrix:** setiap role × read/mutate/export × own org/other org.
2. **Report race:** dua submit paralel untuk lineage sama.
3. **Historical as-of:** late finalization, report masa depan, pergantian revisi/baseline.
4. **Formula parity:** dashboard/periodic/final snapshot/export/AI.
5. **SCurve identity:** duplicate category names dan rename.
6. **Core E2E:** buat/import RAB → baseline → laporan → approve/final → cetak.
7. **Storage failure:** upload sukses/DB gagal dan sebaliknya.

### Kriteria penerimaan

- P0/P1 memiliki regression test yang gagal pada commit audit dan lulus setelah perbaikan.
- Test plan menunjukkan owner dan layer untuk setiap invariant.
- Output parity memakai fixture deterministik dan golden values yang direview.

### Tanggapan / Tantangan Balik

**Status: DITERIMA — benar.** (Claude, 28 Juli 2026)

Tidak ada pembelaan: tidak ada satu pun test lintas-organisasi, dan itulah
sebabnya tiga P0 bisa hidup berdampingan dengan 436 unit test hijau. Jumlah test
mengukur luas, bukan kedalaman ancaman.

**Yang ditambahkan hari ini:** belum ada — perbaikan otorisasi di commit ini
diverifikasi lewat pembacaan kode dan typecheck, bukan test. Saya menyebutkannya
terang-terangan alih-alih mengklaim aman.

**Utang test yang saya akui, berurut prioritas:**

1. Fixture dua organisasi + matriks negatif: role tertinggi org A menerima
   404/403 pada lokasi, paket, akun, run/artefak AI, dan route PDF milik org B.
2. Race submit laporan paralel di PostgreSQL (menguji advisory lock CALC-02).
3. Parity output: layar vs PDF vs Excel vs WhatsApp untuk satu fixture.
4. Golden test as-of snapshot begitu CALC-01 diputuskan.

Ketiga yang pertama butuh PostgreSQL; lingkungan kerja saya tidak punya, jadi
akan dijalankan di CI. Itu alasan, bukan pembenaran — utangnya tetap utang.

---

## 7. Backlog yang sudah diketahui dan dikonfirmasi

Bagian ini tidak dihitung ulang sebagai temuan baru, tetapi tetap relevan terhadap kesiapan produksi.

### 7.1 Status progres belum memisahkan reported/verified/final

`COUNTED_REPORT_STATUSES` menghitung `dikirim`, `disetujui`, dan `final` sebagai satu actual. Ini adalah keputusan aktif, tetapi UI/AI harus selalu menyebut level evidencenya agar angka “dilaporkan” tidak terbaca sebagai “diverifikasi”.

**Tanggapan / Tantangan Balik**

> _Jelaskan keputusan bisnis final dan terminologi UI yang dipilih._

### 7.2 `getLocationProgress` belum mempunyai `asOf`

Sudah dicatat sebagai open issue. CALC-01 menunjukkan dampak konkret tambahan: bukan hanya historical query tidak tersedia, tetapi current-state saat ini ikut dibekukan ke final snapshot.

**Tanggapan / Tantangan Balik**

> _Sertakan desain API as-of dan effective-version rule._

### 7.3 CSP, global rate limit, dan RLS belum lengkap

Dokumentasi sudah mencatat security headers/CSP, rate limiting selain login, dan RLS sebagai pekerjaan lanjutan. AUTH-01 sampai DATA-02 harus diperbaiki di application/data model terlebih dahulu; RLS kemudian menjadi defense-in-depth.

**Tanggapan / Tantangan Balik**

> _Sertakan threat model dan urutan implementasi yang disepakati._

### 7.4 Data seed/fixture belum mewakili kualitas produksi

Open issues telah mencatat masalah seed dan kategori/item. Ini memperlemah keyakinan bahwa formula dan generator sudah diuji terhadap variasi RAB nyata.

**Tanggapan / Tantangan Balik**

> _Sertakan corpus RAB anonymized/golden fixture yang akan dipakai._

### 7.5 Output parity dan performa laporan periodik

Laporan periodik besar, rendering PDF/Excel, dan parity antar-output masih perlu pengujian produksi. Penggunaan `Number(BigInt)` di jalur laporan juga perlu guard safe-integer untuk kontrak bernilai sangat besar, sebagaimana telah dicatat di backlog.

**Tanggapan / Tantangan Balik**

> _Sertakan batas maksimum nilai kontrak dan hasil benchmark/golden parity._

---

## 8. Rencana remediasi

## Fase 0 — Putuskan arsitektur tenancy (sebelum coding luas)

**Target:** 1–2 hari keputusan.

- Tetapkan single-org-per-deployment atau shared multi-org.
- Jika single-org, enforce satu org dan sederhanakan model/claims.
- Jika multi-org, definisikan tenant root, unrestricted-within-org, dan data global platform.

## Fase 1 — Tutup P0

**Target:** sebelum go-live/tenant kedua.

- Perbaiki `hasLocationAccess`/`accessibleLocationIds`.
- Tambahkan package/user/org-scoped query helpers.
- Scope semua halaman/action paket dan user.
- Tambahkan `orgId` AI dan filter sistem.
- Tambahkan regression tests dua organisasi.

## Fase 2 — Jaga integritas laporan resmi

- Implement `getLocationProgressAt`.
- Tetapkan effective RAB/baseline per tanggal.
- Perbaiki final snapshot.
- Tambahkan lock/retry submit laporan dan race test.
- Satukan grand total formula.

## Fase 3 — Perkuat data dan audit

- Composite tenant constraints/check constraints.
- Transactional audit/outbox untuk mutasi penting.
- Scope setting/audit/foto.
- Reconciliation R2.

## Fase 4 — Operasi dan assurance

- Aktifkan CI pada `dev` atau branch protection yang setara.
- Triage 4 advisory moderat.
- Redact health errors.
- Lengkapi E2E, output parity, performance, CSP, dan rate limiting.

---

## 9. Verifikasi yang dijalankan

Semua command dijalankan pada commit dan branch yang tercantum di header.

| Verifikasi | Hasil |
|---|---|
| `pnpm install --frozen-lockfile` | Lulus |
| `pnpm db:generate` | Lulus |
| `pnpm typecheck` | Lulus |
| `pnpm lint` | Lulus |
| `pnpm vitest run tests/unit` | Lulus — 36 file, 428 test |
| `node scripts/license-audit.mjs` | Lulus |
| `pnpm build` dengan env setara CI | Lulus |
| `pnpm audit --prod --audit-level high` | Exit 0; 4 moderate + 1 high yang di-ignore/terdokumentasi |
| `pnpm audit --prod --json` | 4 advisory moderate terurai pada SUPPLY-01 |
| Integration tests | Tidak dijalankan — PostgreSQL/Docker tidak tersedia |
| E2E Playwright | Tidak dijalankan — dependency runtime tidak tersedia |
| Docker image build | Tidak dijalankan — Docker tidak tersedia |
| Status GitHub Actions | Tidak diambil — `gh` CLI tidak tersedia |

Catatan build:

- Build tanpa env gagal dengan benar karena `DATABASE_URL` dan `SESSION_SECRET` wajib.
- Build dengan env CI lulus.
- Next memperingatkan konvensi `middleware` deprecated.
- Turbopack memperingatkan file tracing sangat luas melalui `instrumentation → seed/demo → next.config`; ini belum terbukti sebagai kegagalan, tetapi perlu ditinjau agar bundle tidak membawa file yang tidak semestinya.

---

## 10. Checklist penutupan audit

Gunakan tabel ini sebagai ringkasan kerja; detail dan diskusi tetap disimpan pada blok temuan masing-masing.

| ID | Diterima | Ditolak dgn bukti | Fix PR | Regression test | Closed by/date |
|---|---|---|---|---|---|
| AUTH-01 | ☐ | ☐ |  | ☐ |  |
| AUTH-02 | ☐ | ☐ |  | ☐ |  |
| AUTH-03 | ☐ | ☐ |  | ☐ |  |
| AUTH-04 | ☐ | ☐ |  | ☐ |  |
| AUTH-05 | ☐ | ☐ |  | ☐ |  |
| CALC-01 | ☐ | ☐ |  | ☐ |  |
| CALC-02 | ☐ | ☐ |  | ☐ |  |
| CALC-03 | ☐ | ☐ |  | ☐ |  |
| CALC-04 | ☐ | ☐ |  | ☐ |  |
| DATA-01 | ☐ | ☐ |  | ☐ |  |
| DATA-02 | ☐ | ☐ |  | ☐ |  |
| STORE-01 | ☐ | ☐ |  | ☐ |  |
| AUDIT-01 | ☐ | ☐ |  | ☐ |  |
| SEC-01 | ☐ | ☐ |  | ☐ |  |
| SUPPLY-01 | ☐ | ☐ |  | ☐ |  |
| CI-01 | ☐ | ☐ |  | ☐ |  |
| TEST-01 | ☐ | ☐ |  | ☐ |  |

---

## 11. Kesimpulan

MARLIN mempunyai calculation layer dan lifecycle yang dirancang serius, dan beberapa kontrol—khususnya append-only history serta row lock keuangan—menunjukkan pemahaman integritas data yang baik. Risiko utamanya bukan algoritma aritmetika dasar, melainkan **batas konteks**: konteks organisasi, konteks waktu historis, konteks transaksi paralel, dan konteks identitas kategori.

Urutan aman adalah:

```text
putuskan tenancy
→ tutup authorization lintas-org
→ benahi as-of snapshot dan concurrency laporan
→ enforce invariant di DB
→ perluas test/gate operasi
```

Sebelum rangkaian tersebut selesai, klaim yang aman adalah: aplikasi telah mempunyai fondasi domain yang kuat untuk satu lingkungan terkendali, tetapi belum terbukti aman untuk multi-tenant dan belum sepenuhnya terjamin untuk dokumen historis resmi pada kondisi finalisasi terlambat atau request paralel.

---

## 12. Ringkasan tanggapan Claude (28 Juli 2026)

Seluruh 17 temuan diperiksa ke kode. **Tidak ada yang saya tolak sebagai salah.**
Dua saya terima sebagian dengan koreksi fakta (CALC-03, CI-01), satu saya
sempitkan ruang lingkupnya dengan bukti (AUTH-01: jalur daftar sudah ber-`orgId`
sejak DECISIONS 155; yang bocor adalah pemeriksaan objek tunggal).

### Sudah diperbaiki pada commit ini

| ID | Perbaikan |
|---|---|
| AUTH-01 | `hasLocationAccess()` membuktikan `package.orgId = user.orgId` sebelum role/assignment |
| AUTH-02 | 23 lookup paket/vendor/kontrak/lokasi di `package/actions.ts` ber-scope organisasi aktor |
| AUTH-03 | `requireSameOrgUser()` pada setUserActive/resetUserPassword/setAssignments + validasi lokasi + halaman pengguna difilter organisasi |
| AUTH-05 | Tiga route PDF menegakkan `report.export` (definisi: unduh = ekspor) |
| CALC-02 | `pg_advisory_xact_lock` per lokasi sebelum guard volume di transisi `→ dikirim` |
| CALC-03 | Sentinel `grandTotal = 1` dibuang; nol tetap nol |
| SEC-01 | `/api/health` tidak lagi mengembalikan pesan error database ke publik |

### Menunggu keputusan user (tidak saya putuskan sendiri)

1. **CALC-01 — arti angka progress di blanko harian**: as-of tanggal laporan
   (rekomendasi saya) atau posisi saat finalisasi? Ini mengubah makna setiap
   dokumen final yang sudah terbit.
2. **Kontrak tenancy**: single-organization permanen atau multi-organization
   sungguhan? Perbaikan hari ini aman untuk keduanya, tetapi AUTH-04, DATA-01,
   dan DATA-02 baru layak dikerjakan setelah jawabannya jelas.
3. **CI-01**: menambah pemicu `push: branches: [dev]`, mengingat pemicu itu
   pernah ditolak karena run ganda (DECISIONS 153, M10).
4. **AUTH-03 lanjutan**: larangan reset/nonaktifkan role setara-atau-lebih-tinggi
   dan proteksi admin aktif terakhir — kebijakan, bukan bug.

### Utang yang saya akui terang-terangan

Perbaikan otorisasi di commit ini **belum ditutup test**. Verifikasinya
pembacaan kode + typecheck + lint + build, bukan uji lintas-tenant. Itu persis
kelemahan yang ditunjuk TEST-01, dan menyebutnya di sini lebih berguna daripada
mengklaim aman. Prioritas berikutnya: fixture dua organisasi + matriks negatif,
lalu race test submit paralel di PostgreSQL.
