# Memasang server arsip dingin (mesin sendiri)

Berkas asli foto — byte apa adanya dari kamera, besar, nyaris tidak pernah
dibuka — dipindahkan dari Cloudflare R2 ke mesin sendiri. Foto ber-cap dan
thumbnail yang dilihat orang sehari-hari **tetap di R2** dan tidak pernah lewat
sini.

Keputusannya: [`docs/DECISIONS.md`](./DECISIONS.md) nomor 549 dan 554.

---

## Protokol — satu, dan tidak boleh bercabang

MARLIN bicara dengan dialek `marlin-original-storage`, gateway yang sudah lebih
dulu berjalan di mesin user. Siapa pun yang mau menggantikannya harus menjawab
persis ini:

| | |
|---|---|
| `GET /health` | `{"ok":true}` – **tanpa token**. Inilah yang dipakai tombol Uji sambungan untuk mengenali lawan bicaranya sebelum mengirim apa pun. |
| `GET /v1/status` | `freeBytes`, `totalBytes`, `maxObjectBytes`, `minFreeBytes` |
| `HEAD /v1/objects/<kunci>` | `content-length` + `x-content-sha256`, atau 404 |
| `PUT /v1/objects/<kunci>` | header `X-Content-SHA256`; 201, atau 200 bila kiriman ulang yang identik |
| `GET /v1/objects/<kunci>` | byte aslinya |
| `DELETE /v1/objects/<kunci>` | header `X-Delete-SHA256` **wajib** |

`<kunci>` = kunci logis (`photos/<lokasi>/<tanggal>/<berkas>`) yang di-base64url
tanpa padding — sama untuk R2 dan arsip dingin, jadi satu berkas selalu punya
satu nama di mana pun ia berada.

**Kode penolakan tidak boleh tertukar**, karena keduanya menunjuk perbaikan yang
berbeda:

- **401** = bearer token gateway salah → perbaiki `ORIGINAL_ARCHIVE_TOKEN`
- **403** = Cloudflare Access menghadang, belum sampai ke mesinnya → perbaiki
  Service Token

---

## Yang berjalan sekarang

`marlin-original-storage` (Docker Compose) di `/opt/marlin-original-storage`,
mendengarkan `127.0.0.1:3100`, datanya di `/srv/marlin-originals`, dipublikasikan
lewat Cloudflare Tunnel + Access. Pemasangannya di panduan terpisah milik
gateway itu.

Yang perlu ada di Railway:

| Variabel | Isi |
|---|---|
| `ORIGINAL_ARCHIVE_URL` | `https://<hostname tunnel>` – **wajib https**, tanpa garis miring di akhir |
| `ORIGINAL_ARCHIVE_TOKEN` | `STORAGE_TOKEN` dari `/opt/marlin-original-storage/.env` |
| `ORIGINAL_ARCHIVE_CF_CLIENT_ID` | Client ID Service Token (bila memakai Access) |
| `ORIGINAL_ARCHIVE_CF_CLIENT_SECRET` | Client Secret-nya |

`http://` **ditolak** aplikasinya, bukan diterima diam-diam: tiap permintaan
membawa token di header, dan salah ketik satu huruf tidak boleh sesenyap itu
akibatnya.

---

## Alternatif: penerima di repo ini

`arsip-dingin/server.mjs` menjawab protokol yang sama persis — satu berkas Node
polos, **tanpa satu pun dependensi**, tanpa basis data, tanpa `npm install`.
Ada di sini untuk dua hal: sebagai acuan protokol yang bisa dijalankan, dan
sebagai pengganti kalau suatu saat gateway Docker-nya tidak dipakai lagi.

Alasan tanpa dependensi: mesin itu berjalan bertahun-tahun di pojok ruangan
tanpa ada yang menengok, dan tiap paket npm di dalamnya adalah sesuatu yang
suatu hari harus ditambal karena advisory keamanan — justru di mesin yang paling
jarang disentuh.

```bash
sudo useradd -r -s /usr/sbin/nologin marlin
sudo mkdir -p /opt/marlin-arsip /srv/marlin-arsip
sudo cp arsip-dingin/server.mjs /opt/marlin-arsip/
sudo chown -R marlin:marlin /srv/marlin-arsip
openssl rand -hex 32          # tokennya
```

`/etc/marlin-arsip.env` (izin 600):

```
ARSIP_DIR=/srv/marlin-arsip
ARSIP_TOKEN=<hasil openssl tadi>
ARSIP_PORT=8787
ARSIP_HOST=127.0.0.1
MAX_BYTES=33554432
MIN_FREE_BYTES=21474836480
```

```bash
sudo chmod 600 /etc/marlin-arsip.env
sudo cp arsip-dingin/marlin-arsip.service /etc/systemd/system/
sudo systemctl enable --now marlin-arsip
curl -s localhost:8787/health        # → {"ok":true}
```

`ARSIP_HOST=127.0.0.1` disengaja: port ini tidak pernah terbuka ke internet.
Yang menyambungkannya adalah Tunnel, dari mesin yang sama.

---

## Membuktikan sambungannya

**Sistem → Integrasi → Arsip dingin berkas asli → “Uji sambungan”.**

Perjalanan penuh: kenali lawan bicara (`/health`) → kirim → baca ulang → ambil
kembali → cocokkan byte → hapus. Berkas ujinya kecil, di ruang
`photos/uji-sambungan/`, dan dihapus di langkah terakhir — juga kalau ujinya
gagal di tengah. Tidak menyentuh basis data, tidak menyentuh satu pun foto.

Ping `/health` saja tidak cukup dan karena itu bukan satu-satunya langkah:
halaman login Access menjawab 200, tunnel yang menyambung ke port kosong
menjawab 502, dan gateway yang salah versi bisa menjawab 200 untuk semuanya.
Yang menentukan boleh-tidaknya salinan R2 dibuang adalah perjalanan penuhnya.

Kalau gagal, pesannya menyebut langkah mana dan apa artinya — 401/403/404/413/507
masing-masing menunjuk perbaikan yang berbeda.

## Menyalakan

Di kartu yang sama:

- **Nyalakan** — sebelum ini ditekan, tidak ada satu berkas pun yang berpindah.
- **Masa tenggang** — berapa hari salinan R2 dipertahankan setelah berkasnya
  terbukti aman di sana. Bawaannya **7 hari**: selama seminggu tiap berkas punya
  dua salinan sungguhan, jadi kalau arsipnya rewel di minggu-minggu awal kita
  masih bisa mundur tanpa kehilangan apa pun. Harganya jujur: pemakaian R2 baru
  mulai turun seminggu kemudian. Bisa diisi 0 sesudah yakin.

Pemindahannya berjalan sendiri tiap jam lewat GitHub Actions
(`.github/workflows/cron-arsip-asli.yml`). Untuk melihat hasilnya detik itu juga:
tab **Actions** → *Arsip dingin berkas asli MARLIN* → **Run workflow**.

---

## Kalau ada masalah — apa yang dikerjakan sistem sendiri

Peringatan adalah lapis TERAKHIR. Sebagian besar kerusakan tidak pernah sampai
ke orang karena sudah ditangani sendiri:

| Kejadian | Yang dilakukan sistem |
|---|---|
| Arsip tidak bisa dihubungi | Tidak ada yang dihapus. Dicoba lagi putaran berikutnya. |
| Ada pengiriman gagal di satu putaran | Pembuangan salinan R2 **ditahan seluruhnya** di putaran itu – arsip yang sedang bermasalah bukan tempat aman untuk mengurangi salinan. |
| Berkas lenyap dari mesin arsip | Ketahuan saat pemeriksaan ulang tepat sebelum menghapus. Salinan R2 **tidak** dibuang, catatan "terarsip" dibatalkan, berkasnya dikirim ulang. |
| Isi di arsip beda sidik jarinya | Sama: tidak dibuang, dilaporkan. |
| Satu berkas gagal 5 kali | Berhenti dicoba supaya tidak menyumbat antrean – lalu **dicoba lagi sendiri** setelah 6 jam, jadi gangguan sesaat sembuh tanpa ada yang turun tangan. |
| Disk arsip menipis | Gateway menolak kiriman baru; MARLIN mencatatnya dan memperingatkan. |

Yang tersisa untuk peringatan hanya yang **butuh orang datang ke mesinnya**.
Pemberitahuan untuk hal yang sudah beres sendiri bukan kewaspadaan — ia melatih
orang mengabaikan pesan.

## Peringatan WhatsApp

Sistem → Arsip dingin → **Peringatan WhatsApp** (sakelar sendiri, terpisah dari
sakelar arsip) + tujuan (chatId grup atau nomor). Dikirim untuk:

- berkas yang tercatat terarsip tapi **tidak ada** di mesin arsip;
- pemindahan **macet** lebih dari 24 jam padahal ada antrean;
- ada yang **berhenti dicoba**;
- **sisa disk** di bawah 20 GB.

Satu pesan per hari untuk keadaan yang sama; keadaan yang berubah dikirim
seketika. Pemeriksaannya berjalan di DUA jadwal — putaran arsip tiap jam dan
tugas harian — supaya penjadwal arsip yang mati total tidak menghasilkan
kesunyian sempurna.

## Kalau mesinnya mati

Tidak ada yang rusak, dan tidak ada yang hilang:

- Berkas yang gagal dikirim **tidak** dihapus dari R2. Percobaannya dihitung;
  sesudah 5 kali gagal baris itu dilewati supaya satu berkas bermasalah tidak
  menyumbat antrean, dan muncul di layar sebagai "Berhenti dicoba" beserta
  sebabnya.
- Perbaikan cap, putar foto, dan unduh berkas asli tetap jalan selama salinan
  R2-nya masih ada — arsip dicoba dulu, lalu jatuh balik ke R2.
- Foto yang dilihat orang, laporan, dan dasbor **tidak terpengaruh sama sekali**:
  semuanya memakai versi ber-cap di R2, bukan berkas asli.
- Yang benar-benar terdampak hanya foto yang salinan R2-nya sudah dibuang, dan
  hanya untuk perbaikan cap / putar / unduh asli — dengan pesan galat yang
  menyebut sebabnya, bukan diam.

Sesudah mesinnya hidup lagi, putaran berikutnya melanjutkan sendiri.

## Yang dijaga di sisi penerima

- **Tulis ke berkas sementara, baru ganti nama.** Mati listrik di tengah
  penulisan meninggalkan berkas separuh yang *tidak* terbaca sebagai berkas
  jadi — yang terpotong justru berbahaya, karena terbaca "ada" lalu membuat
  MARLIN menghapus salinan R2-nya.
- **Sidik jari dicocokkan dua kali**: sebelum dikirim (di MARLIN) dan sesudah
  sampai (di penerima). Yang tidak cocok dibuang, bukan disimpan.
- **Kunci sama dengan isi berbeda ditolak** (409), tidak pernah ditimpa.
- **Menghapus wajib menyebut sidik jari** yang diharapkan — penghapusan satu-
  satunya operasi yang tidak bisa dibatalkan, jadi penghapus harus menunjukkan
  ia tahu persis apa yang dihapusnya.

Kesepakatan antara MARLIN dan penerimanya diuji langsung di
`tests/integration/arsip-dingin-penerima.test.ts`: penerima sungguhan dijalankan
sebagai proses terpisah, dipanggil klien sungguhan.
