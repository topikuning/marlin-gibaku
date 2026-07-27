# TEST PLAN

Dokumen HIDUP. Memisahkan **yang sudah ada** dari **yang direncanakan** —
supaya tidak ada yang mengira cakupan uji lebih luas daripada kenyataannya.

Terakhir diselaraskan dengan kode: **2026-07-27**.

## Perintah

```bash
pnpm typecheck
pnpm lint
pnpm vitest run tests/unit
DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
  pnpm vitest run tests/integration          # butuh `prisma migrate deploy` ke DB test
pnpm build
pnpm test:e2e                                # Playwright; butuh server + seed
docker build --no-cache -t marlin:test .
```

Semuanya berjalan sebagai 4 job di GitHub Actions pada push ke `main`/`dev` dan
pada setiap pull request. Gagal = merah.

---

## SUDAH ADA

### Unit — 31 berkas, 390 case

| Area | Berkas |
|---|---|
| **Formula angka** (kanonik) | `progress-calc`, `money`, `scurve`, `sequencing`, `kkp-sheet`, `forecast`, `plan-suggest`, `flatten` |
| Parser | `hps-parser`, `recap-import`, `jadwal-import`, `xlsx-chart` |
| Lifecycle & authz | `lifecycle`, `authz`, `milestone-status`, `milestones-template` |
| WhatsApp | `wa-chat-summary-format`, `wa-ingest-parse`, `wa-message-classify`, `wa-sender-identity`, `wa-summary-lifecycle`, `wa-filename-time` |
| AI Hub | `ai-hub`, `ai-hub-narrative` |
| Integrasi & util | `gdrive-folders`, `gdrive-parse`, `contacts-model`, `env`, `photo-stamp-format`, `photos-sharp` |
| **Penjaga dokumen** | `permission-matrix-doc` — gagal bila `PERMISSION_MATRIX.md` tertinggal dari `authz.ts` |

### Integration (Postgres nyata) — 4 berkas, 47 case

| Berkas | Menjaga |
|---|---|
| `constraints` | Unik (lokasi, tanggal) laporan · unik (laporan, lineage) item · unik kontrak per paket · histori status append-only (trigger) · audit log append-only |
| `daily-report-flow` | draft → item (guard volume > RAB **ditolak**) → kirim → kembalikan → kirim ulang → setujui → final + snapshot · upsert idempotent · transisi ilegal ditolak |
| `return-flow` | Siklus pengembalian laporan |
| `periodic-report` | **Gate integritas perhitungan** — lihat di bawah |

`periodic-report.test.ts` adalah penjaga utama angka:

- **Invarian tabel** — "lalu + ini = s/d" (termasuk saat volume melebihi
  kontrak), "s/d" tidak pernah mundur antar minggu, `lalu(n) = s/d(n−1)`,
  Σ bobot = 100, urutan kategori & baris mengikuti RAB.
- **Reconciliation gate** — dashboard = kurva ringkasan lokasi = blanko KKP
  mingguan; panel saran memakai deviasi yang sama; kurva tidak pernah > 100%;
  harga beku di laporan lama tidak menggeser dashboard.
- **Date-as-of gate** — laporan minggu n tidak melihat minggu n+1; batas
  tanggal periode benar; laporan periode lampau stabil terhadap "hari ini".
- **Revision & lineage gate** — adendum men-supersede revisi (bukan menghapus
  node; FK laporan melindunginya); lineage yang hilang keluar dari realisasi
  aktif tanpa menghapus histori dan tanpa menggelembungkan persen.
- **Fixture emas** (hitungan tangan) — RAB Rp100 jt, realisasi 10 dari 100 unit
  → Rp10 jt / 10,00%; draft tidak dihitung; dikirim/disetujui/final sama;
  grandTotal 0 tidak menghasilkan NaN; dua lokasi satu paket tidak tercampur.
- **Tindak lanjut audit 2026-07-27** — dua revisi/baseline aktif ditolak DB;
  paritas rumus SQL ↔ TS; Σ amount kategori = Σ amount item; siklus koreksi
  (dikembalikan → diperbaiki → dikirim ulang) dihitung SEKALI.

### E2E (Playwright) — 1 berkas, 16 case (desktop + mobile)

`auth.spec.ts`: redirect tanpa sesi · password salah · login admin · paksa
ganti password · logout · mandor tidak melihat menu Pengguna/Keuangan dan
ditolak aksesnya · exec viewer tanpa menu Sistem · program director bisa buka
Pengguna.

---

## BELUM ADA — direncanakan

Diurutkan menurut risiko bila terlewat.

1. **Paritas output** — angka di PDF, Excel, WhatsApp, dan payload AI belum
   dibuktikan sama dengan angka di layar. Semuanya mengonsumsi objek yang sama
   sehingga kesamaannya struktural, tetapi tidak ada yang menangkap kalau
   pembulatan disisipkan di renderer.
2. **E2E alur inti** — baru autentikasi yang ter-E2E. Belum ada: prospek→kontrak
   (idempotent), impor RAB → baseline → weekly plan, laporan lapangan
   ujung-ke-ujung (foto + verifikasi + cetak), adendum, keuangan
   (budget → commitment → invoice → pembayaran parsial), kepatuhan milestone,
   permission per-role di UI.
3. **E2E AI Hub** — pulse → variance → lifecycle laporan → distribusi → Ask.
4. **Diagnostik R2** — endpoint salah vs credential salah harus terbedakan.
5. **Rate limit** — hanya login yang dibatasi; belum ada ujinya.
6. **Authz di level action** — matriks capability diuji sebagai fungsi murni,
   tetapi penolakan pada Server Action nyata (termasuk cross-location) belum
   punya uji integrasi sendiri.

## Aturan

- Setiap perbaikan bug angka WAJIB menyertakan test yang **gagal sebelum
  perbaikan**. Pola inilah yang menemukan DECISIONS 151 dan temuan audit
  2026-07-27 — dibaca saja, semuanya tampak lolos.
- Formula murni diuji di `tests/unit`; apa pun yang menyentuh DB diuji di
  `tests/integration` terhadap Postgres nyata, bukan mock.
- Dokumen turunan (mis. matriks permission) wajib punya test penjaga.
