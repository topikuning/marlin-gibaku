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

## 3. Konfigurasi MARLIN

Set environment variable pada service MARLIN (Railway → Variables):

| Variabel        | Contoh                                   | Keterangan                          |
|-----------------|------------------------------------------|-------------------------------------|
| `WAHA_BASE_URL` | `https://waha-xxxx.up.railway.app`       | URL server WAHA (tanpa `/api`)      |
| `WAHA_API_KEY`  | `ISI_API_KEY_RAHASIA_PANJANG`            | Sama dengan `WAHA_API_KEY` di WAHA  |
| `WAHA_SESSION`  | `default`                                | Opsional (default: `default`)       |

`WAHA_BASE_URL` & `WAHA_API_KEY` **wajib bersamaan** — isi keduanya atau kosongkan
keduanya (kalau kosong, fitur WA menonaktifkan diri, tidak error).

Verifikasi di **Sistem → Diagnostik WhatsApp (WAHA)**: klik "Cek status WhatsApp".
Harus `WORKING`.

## 4. Set grup WA per paket

Di halaman **Paket → Grup WhatsApp paket**:
- Klik **Muat daftar grup dari WhatsApp** → pilih grup dari daftar, **atau**
- Tempel **ID grup** manual (format `1203630xxxxxxxxxxx@g.us`).

Simpan. Sejak itu, semua lokasi paket tersebut mengirim ke grup itu.

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
