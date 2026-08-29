# Cara Kerja Tiga Agen di Repo Ini

Repo ini dikerjakan tiga agen sekaligus: **Claude sesi remote** (punya DB uji,
bisa push), **ECC** (plugin di dalam Claude CLI), dan **Codex**. Berkas ini
mengatur siapa mengerjakan apa, supaya koreksi di antara mereka menghasilkan
bukti, bukan debat.

Dibaca ketiganya. Kalau isinya bertentangan dengan `CLAUDE.md` atau
`PROJECT.md`, dua berkas itu yang menang.

---

## 1. Pembagian peran

**Ketiganya boleh menulis kode.** Yang tidak dibagi rata hanya satu hal:
gerbang terakhir sebelum masuk `dev`.

| Agen | Boleh menulis? | Peran khasnya |
|---|---|---|
| Claude sesi remote | ya | **Pemeriksa terakhir** – satu-satunya yang punya PostgreSQL uji, bisa menjalankan suite lengkap, dan bisa membuktikan sebuah temuan MERAH sebelum diperbaiki |
| ECC (plugin di Claude CLI) | ya | Pembaca diff dengan sudut pandang di luar penulisnya; terbukti menemukan cacat yang luput (§5) |
| Codex | ya | Penanya yang berbeda: *apakah yang diklaim selesai memang dibuktikan oleh tes yang ada?* |

Alurnya:

```
siapa pun menulis di cabangnya sendiri
        ↓ PR ke dev
dua agen lain membaca diff itu (yang menulis tidak mengoreksi dirinya)
        ↓
Claude sesi remote menjalankan gerbang §4 dan membuktikan tiap temuan
        ↓ merge ke dev
dev -> main = PR rilis
```

**"Siapa pun" termasuk pemeriksa terakhir.** Pada 2026-08-29 aturan ini ditulis,
lalu tiga kali berturut-turut dilanggar oleh yang menulisnya: commit didorong
langsung ke `dev` tanpa cabang dan tanpa PR. Alasannya selalu terdengar masuk
akal saat itu ("toh gerbangnya sudah dijalankan") — dan justru itu yang membuat
aturannya perlu ditulis: dengan dua agen atau lebih bekerja bersamaan, `dev`
yang berubah tanpa PR adalah perubahan yang tidak pernah dibaca siapa-siapa,
dan bisa menabrak pekerjaan agen lain yang sedang berjalan.

Nama cabang: `claude/<topik>`, `codex/<topik>`, `ecc/<topik>` — supaya di daftar
cabang terlihat siapa penulisnya tanpa perlu membuka commit-nya.

Gerbang terakhir ada di satu tempat bukan karena penilaian satu agen lebih
tinggi, melainkan karena **DB uji hanya ada di sana**: tanpa itu "sudah
diperbaiki" cuma pernyataan. Dan pemeriksaan itu bersifat **mekanis** —
menjalankan tes dan membuktikan merahnya — bukan menilai ulang niat penulisnya.
Kalau yang diperiksa adalah tulisan pemeriksa itu sendiri, syarat merah-dulu
justru makin ketat: tesnya ditulis lebih dulu, dan kedua agen lain yang
menyatakan cukup atau tidak.

---

## 2. Syarat sebuah temuan diterima: MERAH DULU

Temuan hanya sah kalau bisa dijadikan tes yang **gagal sebelum perbaikan**.

Alurnya, tanpa pengecualian:

1. Tulis tes yang menyatakan perilaku benar.
2. Jalankan tanpa perbaikan → **harus MERAH**. Kalau ia hijau, temuannya belum
   terbukti (atau tesnya di lapisan yang salah — §5).
3. Perbaiki.
4. Jalankan lagi → hijau.
5. Matikan perbaikannya sekali lagi → harus merah lagi. Ini yang membuktikan
   tesnya menguji perbaikan itu, bukan sesuatu yang kebetulan lewat.

Kalau langkah 2 tidak bisa dicapai, temuan itu **belum boleh dilaporkan sebagai
cacat**. Boleh dilaporkan sebagai kecurigaan, dengan menyebut apa yang belum
bisa dibuktikan.

---

## 3. Format review yang diterima

Satu temuan = satu blok. Yang tanpa ketiga baris pertama akan dikembalikan.

```
Temuan  : satu kalimat, menyebut perilaku yang salah — bukan "kode ini aneh"
Bukti   : berkas:baris, atau langkah reproduksi yang bisa dijalankan
Akibat  : apa yang dilihat/dialami pengguna kalau dibiarkan
Usul    : opsional; kalau ada lebih dari satu jalan, sebut pilihannya
```

Yang **tidak** diterima sebagai temuan: preferensi gaya, penamaan, dugaan
performa tanpa angka, dan saran menghidupkan pola pra-rebuild (DECISIONS 051).

---

## 4. Gerbang sebelum merge

Dijalankan pemeriksa terakhir atas **semua** kode yang masuk `dev` — tulisannya
sendiri maupun tulisan agen lain:

- `pnpm typecheck` · `pnpm lint` · `pnpm vitest run tests/unit` · integrasi
  (butuh DB uji). ±7 menit.
- Untuk kode dari agen lain, gerbangnya belum lengkap sampai perubahan itu
  dibuktikan **merah tanpa perbaikannya** (§2). Kalau penulisnya tidak
  menyertakan tes, pemeriksa terakhir yang menuliskannya — bukan meloloskannya
  karena suite lain hijau.
- **E2E tidak dijalankan lokal.** CI menjalankannya pada tiap PR; menjalankannya
  dua kali menambah ±14 menit tanpa menambah satu pun bukti. Perinciannya di
  `CLAUDE.md` §"Gerbang sebelum push". Satu-satunya pengecualian: CI sudah
  melaporkan E2E merah dan kegagalannya perlu direproduksi.
- Tiap temuan pengoreksi yang ditutup harus menyebut **tes mana** yang
  membuktikannya. "Sudah diperbaiki" tanpa nama berkas tes bukan penutupan.

---

## 5. Daftar blind spot yang SUDAH TERBUKTI

Bukan hipotesis. Semuanya pernah terjadi di repo ini dan lolos sekali.

| Blind spot | Kejadiannya | Penangkalnya |
|---|---|---|
| **Tes hijau di lapisan yang salah** | Cadence bulanan dan niat `produksi` lulus tes parser, tapi masih rusak di layar karena pembungkusnya menolak lebih dulu. Ditemukan hanya lewat tangkapan layar pengguna | Uji dari **titik masuk yang dipakai pengguna** (`jawabPertanyaanWa`, server action), bukan dari fungsi dalam |
| **Tes yang justru menjaga cacatnya** | `ai-klaim-terikat-run.test.ts` menegaskan `fakta.every(f => f.periodKey === AKHIR)` — persis percampuran temporal yang jadi cacat | Kalau tes gagal setelah perbaikan, tanyakan dulu apakah tesnya yang salah |
| **Balapan yang tidak terbuka oleh `Promise.all`** | Tes lampiran ganda hijau meski indeks unik dilepas: upsert pesan mengunci lebih dulu | Tahan salah satu jalur (gerbang eksplisit) sampai jalur lain selesai, baru ukur |
| **`git add -A`** | `.data/lampiran/<sha>.pdf` hasil tes ikut ter-commit | Lihat `git status` sebelum add; artefak tes masuk `.gitignore` |
| **Migrasi tidak idempoten** | Ditolak `tests/unit/migrasi-idempoten.test.ts` | `IF NOT EXISTS` pada tiap DDL |
| **Regex untuk menyunting dokumen** | Sebuah regex menghapus 105 baris `OPEN_ISSUES.md` | Sunting berbasis indeks/potongan tepat, lalu periksa selisih barisnya |
| **Angka pengguna "dibetulkan" diam-diam** | Dilarang keras — DECISIONS 203 | Penyesuaian wajib seragam DAN dikatakan di UI; selisih terlalu besar ditolak dengan menyebut sebabnya |

Menambah baris ke tabel ini adalah bagian dari menutup temuan yang menyingkap
kelas kesalahan baru.

---

## 6. Berkas yang membentuk perilaku agen

`.claude/`, `.codex/`, `.agents/`, dan berkas *instincts* bukan kode biasa:
setelah di-merge, ia mengubah cara ketiga agen menilai benar-salah, dan tidak
ada tes yang menangkap kesalahannya. Perubahan pada berkas-berkas itu **dibaca
manusia dulu** sebelum merge, seperti `CLAUDE.md`.

Keluaran analisis ECC/Codex tidak kena aturan ini — yang kena hanya berkas
konfigurasi yang mereka tulis ke repo.
