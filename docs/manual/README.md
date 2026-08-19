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

## Yang belum selesai

- [ ] **Seed khusus manual.** Seed sekarang menampilkan deviasi −99,9% dan
      realisasi 0,1% — buku penuh lencana merah "Kritis" mengajarkan keadaan
      darurat sebagai keadaan normal. Perlu lokasi contoh dengan progres wajar.
- [ ] Bab lapangan: mengisi laporan harian langkah demi langkah, alur koreksi
      (`perlu_koreksi` → perbaiki → kirim ulang), dan chat WhatsApp.
- [ ] Bab manajemen: keuangan, laporan periodik KKP, RAPL, AI.
- [ ] Daftar isi otomatis + nomor halaman per bab.
- [ ] Pertimbangkan ukuran repo: 9 gambar = 1,3 MB. Buku penuh (60+ layar) bisa
      10–20 MB, dan tumbuh tiap kali UI berubah.
