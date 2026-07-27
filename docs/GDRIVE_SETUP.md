# Setup Google Drive (upload laporan ke folder KKP)

Konteks: folder Drive per paket adalah **pemberian KKP**; satu akun Gmail biasa
milik tim didaftarkan sebagai **editor** di folder-folder itu. MARLIN mengakses
Drive lewat OAuth akun Gmail tersebut (refresh token disimpan terenkripsi).

## 1. Buat OAuth Client di Google Cloud Console (sekali)

1. Buka https://console.cloud.google.com → buat project (mis. `marlin-drive`).
2. **APIs & Services → Library** → aktifkan **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**; isi nama app + email.
   - **PENTING**: setelah selesai, klik **Publish app** sehingga status menjadi
     **In production**. Status *Testing* membuat refresh token mati tiap 7 hari.
   - App tidak perlu diverifikasi Google — saat login akan muncul layar
     "unverified app"; klik *Advanced → Continue*. Itu normal (app internal).
   - Di tab **Data access / Scopes**, tambahkan scope
     `https://www.googleapis.com/auth/drive`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application** (bukan Desktop — tipe salah = error 400).
   - Authorized redirect URI: **salin persis** dari Sistem → Integrasi → Google
     Drive (kotak "Authorized redirect URI"). Harus `https://` dan tanpa garis
     miring di akhir. Tambahkan juga `http://localhost:3000/api/gdrive/callback`
     untuk dev.
5. Salin **Client ID** dan **Client secret**.

### Kalau muncul "Access blocked: Authorization Error — Error 400: invalid_request"

Urut dari yang paling sering:

0. **Redirect URI berisi `https://0.0.0.0:8080/...`** → MARLIN tidak tahu
   domain publiknya (platform tidak mengirim `x-forwarded-host`). Set env
   `APP_PUBLIC_URL=https://<domain-marlin>` lalu redeploy. Di Railway,
   `RAILWAY_PUBLIC_DOMAIN` biasanya sudah otomatis tersedia.
1. **Redirect URI tidak terdaftar / beda persis** (termasuk beda `http` vs
   `https`, atau ada `/` di akhir) → samakan dengan kotak di halaman Sistem.
2. **Tipe OAuth client salah** (Desktop/Android/iOS) → harus Web application.
3. **Scope `.../auth/drive` belum ditambahkan** di OAuth consent screen.
4. **App masih status Testing dan akun belum terdaftar sebagai Test user** →
   Publish app, atau tambahkan email akun di daftar Test users.
5. Perubahan di Google Console kadang butuh **beberapa menit** untuk aktif.

Klik tautan **error details** di halaman error Google untuk melihat penyebab
persisnya (mis. `redirect_uri_mismatch`).

## 2. Hubungkan di MARLIN

1. **Sistem → Integrasi → Google Drive**: tempel Client ID + secret → Simpan.
2. Klik **Hubungkan akun Google** → login dengan **akun Gmail yang jadi editor
   folder KKP** → izinkan akses Drive.
3. Klik **Tes koneksi** — harus menampilkan email akun.

## 3. Atur folder per paket

Di halaman paket → kartu **Folder Google Drive paket** → tempel link folder
pemberian KKP → Simpan. MARLIN memvalidasi bahwa akun punya akses.

## 4. Pakai

Halaman lokasi → **Laporan**: tombol **Upload Drive** (laporan harian, PDF) dan
**Upload ke Drive (PDF + Excel)** (laporan mingguan/bulanan). Setiap upload
tercatat (siapa, kapan, file ID) dan bisa diulang.

## Catatan operasional

- Token dicabut / error `invalid_grant` → hubungkan ulang akun di Sistem
  (biasanya karena status app masih Testing, atau password akun diganti).
- Bila folder KKP berupa folder My Drive biasa (bukan Shared Drive), file yang
  diupload MARLIN memakai kuota 15 GB akun Gmail tim — pantau sesekali.
- Enkripsi token butuh `AI_SECRET_ENCRYPTION_KEY` (kunci yang sama dengan
  enkripsi API key AI — sudah ada di production).

## Struktur folder di dalam Drive paket

MARLIN mengikuti 9 folder standar KKP dan menambahkan lapisan **nama lokasi**
supaya satu paket dengan banyak lokasi tetap rapi & seragam:

```
<Folder Drive paket dari KKP>/
├── 1. SPPBJ, SPK, SPMK, RAB, DED/   ← dokumen sppbj, kontrak, spmk, HPS/RAB, DED, adendum, jaminan
├── 2. PCM/                          ← dokumen PCM, BA serah terima lapangan, MC-0
├── 3. LAPORAN HARIAN/
│   └── <Lokasi>/<2026-07 Juli>/     ← PDF laporan harian
│       └── Foto/                    ← seluruh foto laporan hari itu
├── 4. LAPORAN MINGGUAN/<Lokasi>/    ← PDF + Excel per periode
├── 5. LAPORAN BULANAN/<Lokasi>/     ← PDF + Excel per periode
├── 6. DOKUMENTASI/
│   └── <Lokasi>/<2026-07 Juli>/<2026-07-26 Judul kegiatan>/   ← PDF kegiatan + fotonya
├── 7. BERKAS TERMIN/                ← MC berkala, invoice, faktur pajak, BA pembayaran, BAST
├── 8. SHOP DRAWING/                 ← dokumen jenis Shop Drawing
└── 9. AS BUILT/                     ← dokumen jenis As Built Drawing
```

Catatan:

- Folder **dicari dulu berdasarkan nama**; hanya dibuat kalau belum ada. Folder
  yang sudah dibuat KKP (beserta isinya) dipakai apa adanya, tidak diduplikasi.
- Nama folder harus **persis** seperti di atas agar dikenali. Kalau KKP memakai
  penamaan berbeda di suatu paket, MARLIN akan membuat folder baru sesuai daftar
  ini — samakan penamaannya lebih dulu bila tidak diinginkan.
- Dokumen proses tender internal (undangan, penawaran, BA evaluasi, negosiasi,
  sanggah) **sengaja tidak** punya tujuan folder — tidak ikut terupload.
- Cek kelengkapan per paket: halaman paket → kartu **"Kelengkapan folder KKP di
  Drive"** (jumlah terupload vs yang layak disetor + kapan terakhir).

## Upload ulang = versi baru, bukan file kembar

Upload ulang laporan/dokumen yang sama TIDAK membuat file baru. MARLIN mencari
file dengan nama sama di folder tujuan, lalu memperbarui isinya — Drive
menyimpannya sebagai **revisi**:

- Isi lama tetap bisa dibuka: klik kanan file → **Kelola versi** (Manage
  versions) → unduh versi sebelumnya.
- Tautan file tidak berubah, jadi link yang sudah dibagikan ke KKP tetap hidup.
- Revisi dipin (`keepRevisionForever`) supaya tidak dipangkas otomatis — laporan
  resmi harus bisa ditelusuri kapan pun.
- Banner hasil upload membedakan "file baru" dan "file diperbarui (versi baru di
  Drive)" supaya jelas apa yang terjadi.

Catatan: file kembar yang terlanjur dibuat SEBELUM perbaikan ini tidak dihapus
otomatis — hapus manual salah satunya di Drive. Setelah itu upload berikutnya
akan memperbarui file yang tersisa.
