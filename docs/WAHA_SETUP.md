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

---

## 6. Tanya-jawab bebas (DECISIONS 338 + 339)

Tidak ada langkah pemasangan tambahan: fitur ini memakai **webhook yang sama**
seperti arsip percakapan di atas.

**Cara memakainya**

- **Chat pribadi** ke nomor MARLIN: tulis pertanyaannya langsung.
- **Grup**: MARLIN hanya menjawab kalau **di-mention** (`@` lalu pilih nomor
  MARLIN dari daftar). Mengetik teks "@marlin" saja TIDAK cukup — penyebutan
  dibaca dari daftar JID pesan, bukan dari isi teksnya, karena nama tampilan
  bisa diubah siapa saja.

**Yang bisa ditanyakan** (bahasa bebas, tidak ada format baku):

| contoh | dijawab dengan |
| --- | --- |
| "ada kendala apa hari ini" | kendala belum selesai per lokasi |
| "progress hari ini di Kedung Mutih" | realisasi / rencana / deviasi + kegiatan hari ini |
| "mana yang deviasinya negatif" | lokasi tertinggal dari kurva-S, paling parah dulu |
| "siapa yang belum lapor" | kelengkapan laporan harian |

Di luar keempatnya MARLIN akan **mengaku belum mengerti** dan menyebut apa yang
bisa dijawab — ia tidak menebak niat yang paling mirip.

**Pola yang jelas dijawab tanpa AI** (DECISIONS 375)

Pertanyaan yang tidak punya tafsir kedua — "progress hari ini", "ada kendala
apa", "siapa yang belum lapor", "laporan tanggal 12", "laporan mingguan",
"mana yang deviasinya negatif" — dibaca langsung tanpa memanggil layanan AI.
Akibatnya tiga hal: balasannya lebih cepat, tidak memakai kuota AI, dan
**tetap berfungsi saat layanan AI sedang mati**.

Syaratnya seluruh kata dalam kalimat harus terjelaskan. Begitu ada kata yang
tidak dikenali — termasuk nama tempat yang tidak ada di katalog — pertanyaannya
diserahkan ke AI seperti biasa. Jalur cepat ini karena itu hanya bisa
mempercepat, tidak pernah melebarkan jawaban: "progress di Kedung Mutih" tidak
akan berubah diam-diam menjadi progress seluruh lokasi.

Di **Sistem → WhatsApp**, jejak audit tiap jawaban menyebut `jalur`:
`deterministik` (tanpa AI), `lanjutan` (susulan yang disambung dari konteks),
`klarifikasi` (jawaban atas pilihan), atau `ai`.

**Pertanyaan susulan** (DECISIONS 377)

Anda tidak perlu mengulang subjeknya. Setelah bertanya *"progress hari ini di
Kedung Mutih"*, cukup tulis *"kalau kemarin?"* — MARLIN menyambungnya sendiri
(niatnya dipinjam dari pertanyaan sebelumnya, tanggalnya dari yang baru Anda
tulis), tanpa memanggil AI.

- Berlaku **30 menit**; sesudah itu MARLIN menawarkan pilihan seperti biasa.
- Milik **Anda saja** — konteks orang lain di grup yang sama tidak terpakai.
- Kalau susulan Anda menyebut lokasi sendiri, lokasi itu yang dipakai; konteks
  tidak pernah menambahinya.
- Konteks **tidak pernah memperlebar** apa yang boleh Anda lihat. Lokasi yang
  kini di luar penugasan Anda (atau di luar paket grup tempat Anda bertanya)
  tidak akan muncul — MARLIN mengaku tidak menemukannya.

**Pertanyaan yang kabur DITAWARI pilihan** (DECISIONS 376)

Kalau pertanyaannya menyebut waktu tanpa menyebut maksud — mis. *"bagaimana
yang kemarin?"* — MARLIN tidak lagi menjawab "belum mengerti". Ia menawarkan
2–3 tafsir memakai kata yang Anda tulis sendiri, dan Anda cukup **membalas
angkanya** (`1`, `2`, `3`).

| Hal | Perilaku |
|---|---|
| Berlaku | 12 menit; sesudah itu MARLIN mengatakan pilihannya sudah ditutup |
| Milik siapa | **Hanya penanya**. Di grup, orang lain yang mengetik `1` tidak mengambil alih klarifikasi Anda |
| Biaya AI | Nol — tawaran maupun jawabannya tidak memanggil AI |
| Angka dalam kalimat | *"laporan tanggal 2"* tetap dibaca sebagai pertanyaan, bukan pilihan |

Kalau pengirim di grup tidak bisa dikenali sama sekali (tidak ada nomor maupun
@lid di payload), pilihan **tidak** ditawarkan — kalau ditawarkan, siapa pun
yang membaca bisa menjawabnya.

**Dua syarat yang sering jadi sebab "MARLIN tidak menjawab"**

1. **Nomor penanya harus terdaftar.** Diambil dari `Nomor WhatsApp` di data
   penggunanya (`waNumber`, atau `phone`). Nama tampilan WhatsApp tidak pernah
   dipakai — siapa pun bisa mengubahnya. Nomor tak dikenal yang mengirim chat
   pribadi sengaja **didiamkan**, bukan dibalas.
2. **Sesi WAHA harus berstatus `WORKING`.** Nomor MARLIN sendiri dibaca dari
   `me.id` sesi; kalau sesinya belum login, MARLIN tidak tahu kapan ia
   di-mention dan grup **tidak dilayani sama sekali**.

**Apa yang boleh keluar di grup**

Jawaban di grup **tertaut paket** selalu dipotong ke lokasi paket grup itu saja —
juga untuk super admin, karena yang menentukan bukan izin penanya melainkan siapa
yang ikut membaca. Pemotongannya selalu ditulis di balasan.

Grup yang **belum tertaut paket** tidak dilayani, dengan satu pengecualian
(DECISIONS 371): pengirim yang terverifikasi sebagai **Super Admin** atau
**Program Director** dijawab memakai lingkup **organisasinya**, dan balasannya
diawali penanda yang menyebut dasar itu supaya anggota grup lain tahu kenapa data
proyek muncul di grup yang tidak tertaut apa pun. Verifikasinya lewat nomor/LID
tersimpan — nama tampilan WhatsApp tidak pernah menjadi bukti identitas.

Seluruh keputusan "siapa dilayani di mana dengan lingkup apa" ada di satu tempat,
`src/lib/waha/resolver-kanal.ts`. Kalau aturannya perlu diubah, ubah di sana —
bukan di `tanya.ts`.

**Status pengiriman — apa artinya**

Sejak DECISIONS 374 setiap kiriman WhatsApp lewat SATU gateway dan tercatat di
outbox. Statusnya berarti persis apa yang tertulis:

| Status | Artinya |
|---|---|
| `Diterima WAHA` | WAHA menerima permintaannya. **Belum tentu sampai** — WAHA menjawab 2xx juga saat sesinya belum login. |
| `Terkirim` | Sampai server WhatsApp (`message.ack` = 1). |
| `Sampai` | Sampai perangkat tujuan (ack = 2). |
| `Dibaca` | Sudah dibaca (ack ≥ 3). |
| `Gagal` | Gagal kirim — layak dicoba lagi (mis. jaringan, sesi mati). |
| `Ditolak` | WhatsApp menolak (4xx, mis. 463 nomor tak terdaftar). **Mengulanginya tidak akan berhasil** — periksa tujuannya. |

Status hanya boleh NAIK; ack yang datang terlambat tidak menurunkannya.
Kegagalan adalah pengecualian: ia punya bukti sendiri dan menang atas status
maju mana pun.

Agar `Terkirim`/`Sampai`/`Dibaca` benar-benar muncul, **event `message.ack`
harus diaktifkan di WAHA** untuk URL webhook yang sama. Tanpa itu, kiriman akan
berhenti di `Diterima WAHA` selamanya — dan itu jujur: memang tidak ada bukti
lain yang pernah tiba.

Diagnosanya di **Sistem → WhatsApp → Pengiriman keluar**.

**Batas**

- Periode bebas: hari ini, kemarin, tanggal tertentu, minggu/bulan (DECISIONS
  356–358). Progress & deviasi untuk tanggal lampau dihitung **pada tanggal itu**
  (DECISIONS 369).
- **Kendala** punya tiga cara baca, dan untuk periode lampau MARLIN
  **menawarkan pilihan** alih-alih memilihkan (DECISIONS 381):

  | Anda tulis | MARLIN |
  |---|---|
  | "ada kendala apa" / "kendala hari ini" | langsung: yang masih terbuka sekarang |
  | "kendala minggu lalu" | menawarkan **1.** semua yang *dibuka* minggu lalu (termasuk yang sudah selesai) **2.** yang dibuka minggu lalu dan *masih terbuka* |

  Yang tetap TIDAK bisa dijawab: *"kendala apa yang berstatus terbuka **pada**
  hari X"*. Itu butuh riwayat status yang belum dicatat, dan tidak satu pun
  pilihan di atas berpura-pura bisa menjawabnya.
- Maksimal 15 baris per jawaban (20 untuk kendala); pemotongannya disebutkan.
- Memakai kuota AI Hub — kill-switch & batas laju di **Sistem → AI Hub** berlaku,
  dan tiap pertanyaan tercatat di `ai_runs` sebagai kind `tanya`.
