# Memasang server arsip dingin (Lenovo)

Berkas asli foto — byte apa adanya dari kamera, besar, nyaris tidak pernah
dibuka — dipindahkan dari Cloudflare R2 ke mesin sendiri. Foto ber-cap yang
dilihat orang sehari-hari **tetap di R2** dan tidak pernah lewat sini.

Keputusannya: [`docs/DECISIONS.md`](./DECISIONS.md) nomor 549.

---

## Yang perlu disiapkan

| | |
|---|---|
| Mesin | Lenovo (atau apa saja) yang menyala terus, Linux, **Node 20+** |
| Disk | seukuran berkas asli yang mau disimpan. Angkanya bisa dilihat dulu: Sistem → Integrasi → **Isi penyimpanan R2** → Periksa |
| Jalan masuk | Cloudflare Tunnel (gratis). **Tidak perlu** IP publik, tidak perlu buka port di router |

Kalau salah satunya belum ada, tidak apa-apa: sampai semuanya siap, MARLIN
berjalan persis seperti sekarang. Fitur ini mati sampai dinyalakan.

---

## 1 · Di Lenovo — pasang penerimanya

Yang dijalankan ada di repo ini, `arsip-dingin/server.mjs`: satu berkas Node
polos, **tanpa satu pun dependensi**, tanpa basis data. Tidak ada `npm install`.

```bash
sudo useradd -r -s /usr/sbin/nologin marlin
sudo mkdir -p /opt/marlin-arsip /srv/marlin-arsip
sudo cp arsip-dingin/server.mjs /opt/marlin-arsip/
sudo chown -R marlin:marlin /srv/marlin-arsip

# Rahasianya — SIMPAN, nanti dipakai lagi di Railway
openssl rand -hex 32
```

Buat `/etc/marlin-arsip.env` (izin 600, hanya root yang boleh baca):

```
ARSIP_DIR=/srv/marlin-arsip
ARSIP_TOKEN=<hasil openssl tadi>
ARSIP_PORT=8787
ARSIP_HOST=127.0.0.1
```

```bash
sudo chmod 600 /etc/marlin-arsip.env
sudo cp arsip-dingin/marlin-arsip.service /etc/systemd/system/
sudo systemctl enable --now marlin-arsip
curl -s localhost:8787/sehat        # → {"siap":true}
```

`ARSIP_HOST=127.0.0.1` disengaja: port ini **tidak pernah** terbuka ke
internet. Yang menyambungkannya adalah Tunnel di langkah berikutnya, dari mesin
yang sama.

## 2 · Di Lenovo — jalan masuk dari internet

```bash
cloudflared tunnel login
cloudflared tunnel create marlin-arsip
cloudflared tunnel route dns marlin-arsip arsip.domain-anda.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: marlin-arsip
credentials-file: /root/.cloudflared/<id>.json
ingress:
  - hostname: arsip.domain-anda.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

```bash
sudo cloudflared service install
```

Sesudah ini `https://arsip.domain-anda.com/sehat` sudah bisa dibuka dari mana
saja. Tokennya yang menjaga isinya.

**Kalau mau dua lapis** (opsional): pasang Cloudflare Access di hostname itu,
buat *Service Token*, dan simpan Client ID + Secret-nya untuk langkah 3.

## 3 · Di Railway — dua variabel (opsional dua lagi)

Settings → Variables:

| Variabel | Isi |
|---|---|
| `ORIGINAL_ARCHIVE_URL` | `https://arsip.domain-anda.com` — **wajib https**, tanpa garis miring di akhir |
| `ORIGINAL_ARCHIVE_TOKEN` | token dari langkah 1 |
| `ORIGINAL_ARCHIVE_CF_CLIENT_ID` | hanya kalau pakai Cloudflare Access |
| `ORIGINAL_ARCHIVE_CF_CLIENT_SECRET` | hanya kalau pakai Cloudflare Access |

`http://` akan **ditolak** aplikasinya, bukan diterima diam-diam: tiap
permintaan membawa token di header, dan salah ketik satu huruf tidak boleh
sesenyap itu akibatnya.

## 4 · Nyalakan di layar

Sistem → Integrasi → **Arsip dingin berkas asli**:

- **Nyalakan** — sebelum ini ditekan, tidak ada satu berkas pun yang berpindah.
- **Masa tenggang** — berapa hari salinan R2 dipertahankan setelah berkasnya
  terbukti aman di Lenovo. Bawaannya **7 hari**: selama seminggu tiap berkas
  punya dua salinan sungguhan, jadi kalau arsipnya rewel di minggu-minggu awal
  kita masih bisa mundur tanpa kehilangan apa pun. Harganya jujur: pemakaian R2
  baru mulai turun seminggu kemudian. Bisa diisi 0 (buang segera) sesudah yakin.

Pemindahannya berjalan sendiri tiap jam lewat GitHub Actions
(`.github/workflows/cron-arsip-asli.yml`). Untuk melihat hasilnya detik itu
juga tanpa menunggu: tab **Actions** → *Arsip dingin berkas asli MARLIN* →
**Run workflow**.

---

## Kalau Lenovo mati

Tidak ada yang rusak, dan tidak ada yang hilang:

- Berkas yang gagal dikirim **tidak** dihapus dari R2. Percobaannya dihitung;
  sesudah 5 kali gagal baris itu dilewati supaya satu berkas bermasalah tidak
  menyumbat antrean, dan muncul di layar sebagai "Berhenti dicoba" beserta
  sebabnya.
- Perbaikan cap, putar foto, dan unduh berkas asli tetap jalan selama salinan
  R2-nya masih ada — arsip dicoba dulu, lalu jatuh balik ke R2.
- Foto yang dilihat orang, laporan, dan dasbor **tidak terpengaruh sama
  sekali**: semuanya memakai versi ber-cap di R2, bukan berkas asli.
- Yang benar-benar terdampak hanya foto yang salinan R2-nya sudah dibuang, dan
  hanya untuk perbaikan cap / putar / unduh asli — dengan pesan galat yang
  menyebut sebabnya, bukan diam.

Sesudah Lenovo hidup lagi, putaran berikutnya melanjutkan sendiri. Tidak ada
yang perlu diulang dengan tangan.

## Yang dijaga penerimanya

- **Tulis ke berkas sementara, baru ganti nama.** Mati listrik di tengah
  penulisan meninggalkan berkas `.sedang-ditulis`, bukan berkas asli yang
  terpotong separuh — yang terpotong justru berbahaya, karena terbaca "ada" dan
  membuat MARLIN menghapus salinan R2-nya.
- **Sidik jari dicocokkan dua kali**: sebelum dikirim (di MARLIN) dan sesudah
  sampai (di penerima). Yang tidak cocok dibuang, bukan disimpan.
- **Kunci sama dengan isi berbeda ditolak** (409), tidak pernah ditimpa. Arsip
  yang boleh ditimpa bukan arsip.
- **Kunci di luar bentuk `photos/<lokasi>/<tanggal>/<berkas>` ditolak**, di
  kedua sisi.

Kesepakatan antara MARLIN dan penerimanya diuji langsung di
`tests/integration/arsip-dingin-penerima.test.ts` — penerima sungguhan
dijalankan sebagai proses terpisah, dipanggil klien sungguhan.

## Memeriksa isinya

Berkasnya tersimpan apa adanya, dengan nama seperti di R2:

```
/srv/marlin-arsip/photos/knmp-besole-tulungagung/2026-09-08/<id>.asli.jpg
/srv/marlin-arsip/photos/knmp-besole-tulungagung/2026-09-08/<id>.asli.jpg.sha256
```

Jadi cadangan ke disk lain cukup `rsync -a /srv/marlin-arsip/ /media/cadangan/`.
Berkas `.sha256` adalah sidik jari yang dihitung saat menerima — disimpan supaya
pemeriksaan "sudah ada belum" tidak perlu membaca ulang seluruh berkas tiap kali.
