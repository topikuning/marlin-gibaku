# Integrasi WhatsApp via WAHA

MARLIN mengirim laporan & kegiatan lapangan ke **grup WhatsApp per paket** lewat
[WAHA](https://waha.devlike.pro) (WhatsApp HTTP API) yang di-host terpisah.

Karena hierarki **lokasi → paket**, setiap kiriman terkait lokasi otomatis diarahkan
ke grup WhatsApp paketnya.

---

## 1. Deploy server WAHA (terbaru)

WAHA adalah container Docker terpisah dari MARLIN. Pakai image **terbaru**:

```bash
docker run -d --name waha --restart unless-stopped \
  -p 3000:3000 \
  -e WAHA_API_KEY='ISI_API_KEY_RAHASIA_PANJANG' \
  -e WHATSAPP_DEFAULT_ENGINE=NOWEB \
  -e WAHA_PRINT_QR=false \
  -v waha-sessions:/app/.sessions \
  devlikeapro/waha:latest
```

- `devlikeapro/waha:latest` = edisi Core gratis (cukup: sendText/sendImage/sendFile/groups).
  Engine `NOWEB` ringan (WebSocket, tanpa browser) — cocok untuk server kecil. Alternatif:
  `WEBJS` (berbasis browser, lebih berat) atau `GOWS`.
- `WAHA_API_KEY` = kunci rahasia bebas (samakan dengan `WAHA_API_KEY` di MARLIN).
- Volume `waha-sessions` menyimpan sesi login supaya tidak perlu scan QR ulang setiap restart.

### Di Railway
Buat **service baru** dari image `devlikeapro/waha:latest`, set `WAHA_API_KEY` +
`WHATSAPP_DEFAULT_ENGINE=NOWEB`, tambahkan **volume** ke `/app/.sessions`, dan expose
port 3000 (dapatkan URL publik, mis. `https://waha-xxxx.up.railway.app`).

> Server WAHA sebaiknya TIDAK publik tanpa proteksi — API key sudah wajib, tapi batasi
> akses jaringan bila memungkinkan.

## 2. Login sesi WhatsApp (scan QR)

1. Buka dashboard WAHA di `https://<host-waha>/` (Swagger UI + dashboard).
2. Start session `default` (POST `/api/sessions` atau lewat dashboard).
3. Ambil QR: `GET /api/{session}/auth/qr` atau menu dashboard, lalu **scan dengan HP**
   memakai **akun WhatsApp pengirim** (nomor yang menjadi anggota semua grup paket).
4. Status berubah menjadi `WORKING` saat berhasil.

Akun WhatsApp pengirim **harus sudah menjadi anggota** setiap grup tujuan.

## 3. Konfigurasi MARLIN (di halaman Sistem — bukan environment)

Konfigurasi WAHA disimpan sebagai **setting aplikasi di database**, diisi lewat UI,
**tanpa perlu redeploy**. Buka **Sistem → WhatsApp (WAHA)** (khusus super admin):

| Field         | Contoh                              | Keterangan                                    |
|---------------|-------------------------------------|-----------------------------------------------|
| URL server    | `https://waha-xxxx.up.railway.app`  | URL server WAHA (tanpa `/api`)                |
| API key       | `ISI_API_KEY_RAHASIA_PANJANG`       | Sama dengan `WAHA_API_KEY` di container WAHA  |
| Nama sesi     | `default`                           | Opsional (default: `default`)                 |

- API key **hanya dibaca di server** (tidak dikirim ke browser) dan ditampilkan tersamar.
  Saat menyimpan, **kosongkan** field API key untuk mempertahankan yang lama; ketik `-`
  lalu simpan untuk menghapus.
- Ganti server WAHA / rotasi key cukup ubah di sini — langsung berlaku, tanpa redeploy.

Verifikasi: klik **Cek status WhatsApp** di kartu yang sama. Harus `WORKING`.

## 4. Set grup WA per paket

Di halaman **Paket → Grup WhatsApp paket**, ada 3 cara (WhatsApp TIDAK menampilkan
ID grup di aplikasinya — ID hanya bisa didapat lewat WAHA):

1. **Muat daftar grup** → pilih dari daftar. ⚠️ Untuk engine **NOWEB**, daftar grup
   HANYA muncul bila **store diaktifkan** (lihat catatan di bawah). Tanpa store,
   daftar kosong walau sesi `WORKING`.
2. **Link undangan grup (disarankan, tanpa store):** di WhatsApp buka grup → Info grup
   → *Tautan undangan grup* → Salin → tempel di form → **Ambil ID dari link**. Sistem
   meresolusi ID grup via WAHA (`join-info`/`join`). Nomor pengirim harus anggota grup.
3. **Tempel ID grup manual** (`1203630xxxxxxxxxxx@g.us`) bila sudah tahu ID-nya.

Simpan. Sejak itu, semua lokasi paket tersebut mengirim ke grup itu.

### (Opsional) Aktifkan NOWEB store agar "Muat daftar grup" berfungsi
Engine NOWEB tidak menyimpan daftar grup/kontak secara default. Untuk mengaktifkan
endpoint `GET /groups`, saat membuat sesi kirim konfigurasi store, atau set env pada
container WAHA lalu start ulang sesi:

```
WHATSAPP_DEFAULT_ENGINE=NOWEB
WHATSAPP_STORE_ENABLED=True
WHATSAPP_STORE_FULLSYNC=True
```

Bila tidak ingin repot, **lewati ini** — pakai Cara 2 (link undangan) yang tidak butuh store.

## 5. Kirim kegiatan lapangan (1 klik)

Di **Lokasi → Kegiatan & Dokumentasi Lapangan**, tiap kegiatan punya tombol
**Kirim ke WhatsApp**: mengirim ringkasan teks (judul, jenis, tanggal, peserta,
kendala, solusi, lokasi) + **semua foto** (sebagai gambar) + **semua dokumen**
(sebagai file) ke grup paket. Setelah terkirim, ditandai "✓ Terkirim <waktu>"
(bisa dikirim ulang bila perlu).

---

## Catatan teknis

- File dikirim sebagai **base64** (`file.data`) dari byte yang diambil MARLIN sendiri
  dari R2 — jadi WAHA tidak perlu bisa menjangkau presigned URL R2 kita.
- Foto sudah ber-cap (waktu/GPS/perusahaan) saat unggah, dikirim apa adanya (JPEG).
- Endpoint yang dipakai: `POST /api/sendText`, `/api/sendImage`, `/api/sendFile`;
  `GET /api/{session}/groups`; `GET /api/sessions/{session}`. Auth header `X-Api-Key`.
- Konfigurasi (URL/API key/sesi) disimpan di tabel `AppSetting` (key-value, effective-
  dated) — pola sama dengan Branding — bukan environment. Lihat `src/lib/waha/config.ts`.
