# Buku Manual MARLIN

Buku manual pengguna, **screenshot-nya dibangkitkan skrip** — bukan dijepret dan
ditempel tangan.

## Kenapa dibangkitkan

UI MARLIN masih bergerak cepat. Dalam satu hari (2026-08-18) Master Data,
Rencana & RAB, dan Progress dirombak seluruhnya (DECISIONS 359/362/363). Buku
yang gambarnya ditempel manual akan basi dalam hitungan minggu — dan yang paling
berbahaya, **tidak ada yang tahu bagian mana yang sudah bohong**.

Dengan pipeline ini, memperbarui seluruh buku sesudah UI berubah cukup dua
perintah.

## Cara membangun

```bash
# 1. MARLIN harus jalan dengan database contoh yang sudah di-seed
pnpm build && pnpm start          # atau pnpm dev

# 2. Jepret ulang seluruh gambar
pnpm manual:tangkap               # atau: pnpm manual:tangkap hari-ini foto-cepat

# 3. Bangun HTML + PDF A4
pnpm manual:bangun
```

Hasilnya di `docs/manual/keluaran/manual-marlin.pdf` (tidak di-commit — ia
artefak build).

Variabel lingkungan: `MANUAL_BASE_URL` (default `http://localhost:3000`),
`MANUAL_PASSWORD` (default `marlin123`), `PLAYWRIGHT_CHROMIUM_PATH` bila
Chromium-nya tidak di tempat baku.

## Susunan

| Berkas | Isi |
|---|---|
| `bab/*.md` | Naskah. Urutan bab dari nama berkas (`01-`, `02-`, …) |
| `gambar/*.png` | Hasil jepretan, **di-commit** supaya buku bisa dibangun tanpa aplikasi jalan |
| `gambar/manifes.json` | Dibangkitkan `manual:tangkap`; sumber keterangan tiap gambar |
| `scripts/manual/daftar-gambar.ts` | **Satu sumber kebenaran**: id, peran, halaman, lebar layar |

## Menyebut gambar di naskah

Tulis `{{gambar:id}}` pada barisnya sendiri:

```markdown
Sesudah masuk, Anda mendarat di Hari Ini.

{{gambar:hari-ini}}
```

Keterangannya diambil dari `daftar-gambar.ts` — **tidak ditulis di naskah**.
Keterangan yang disalin ke dua tempat cepat atau lambat berbeda.

## Yang menggagalkan build, dan itu disengaja

1. **Gambar disebut naskah tapi tidak ada** — salah ketik id, atau gambar dihapus.
2. **Gambar dijepret tapi tidak pernah dipakai** — naskahnya tertinggal.
3. **Gambar tidak termuat saat mencetak** — berkasnya ada di disk tapi peramban
   tidak berhasil memuatnya. Ini pernah terjadi: PDF terbit "sukses" berisi
   sembilan kotak kosong karena path relatifnya salah, sementara penjaga
   naskah-vs-manifes tetap hijau. Yang bisa membuktikan sebuah gambar terlihat
   hanyalah peramban yang mencetaknya.
4. **CSS tidak termuat saat menjepret** — halaman tanpa stylesheet tetap terpotret
   rapi sebagai teks polos (DECISIONS 352).

## Seed khusus manual

```bash
pnpm db:seed          # dasar (org/user/paket/lokasi/RAB/baseline)
pnpm manual:seed      # dandani Purworejo jadi lokasi "wajar" (DECISIONS 366)
```

`manual:seed` men-generate ulang baseline Purworejo dengan tanggal kontrak
RELATIF ke sekarang (selalu "sedang berjalan", tidak pernah basi), lalu mengisi
laporan harian beberapa minggu, rencana mingguan, dan 1-2 kendala — deviasi
kecil (±5%), bukan lencana merah "Kritis" di semua layar. Idempotent lewat
SKIP: `daily_report_status_history` append-only (trigger DB), jadi sekali
Purworejo punya laporan, run berikutnya dilewati apa adanya. Untuk regenerasi
total, reset database dulu (`pnpm db:reset` lalu `pnpm db:seed`).

Foto perlu R2 (opsional) — di sandbox/dev tanpa R2, bagian foto dilewati
otomatis (skrip tidak gagal). Untuk foto sungguhan tanpa akun R2 asli, jalankan
mock storage lokal (S3-compatible minimal, TLS asli — lihat komentar di
berkasnya):

```bash
tsx scripts/manual/mock-r2.ts 9444 /tmp/mock-r2/data <cert.pem> <key.pem>
# lalu jalankan manual:seed DAN server Next dengan R2_ENDPOINT=https://127.0.0.1:9444
# (+ R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY apa saja, NODE_EXTRA_CA_CERTS=<ca-cert.pem>)
```

## Yang belum selesai

- [ ] Bab lapangan: mengisi laporan harian langkah demi langkah, alur koreksi
      (`perlu_koreksi` → perbaiki → kirim ulang), dan chat WhatsApp.
- [ ] Bab manajemen: keuangan, laporan periodik KKP, RAPL, AI.
- [ ] Daftar isi otomatis + nomor halaman per bab.
- [ ] Pertimbangkan ukuran repo: 9 gambar = 1,3 MB. Buku penuh (60+ layar) bisa
      10–20 MB, dan tumbuh tiap kali UI berubah.
