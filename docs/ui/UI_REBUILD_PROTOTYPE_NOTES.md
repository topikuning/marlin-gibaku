# MARLIN UI Rebuild — Prototype Notes

Status: prototype selesai dan tervalidasi pada 28 Juli 2026.

## Keputusan awal

- Prototype berada di `/prototype/ui-rebuild` dan hanya aktif saat `ENABLE_UI_PROTOTYPE=true`.
- Semua layar berada dalam shell prototype terisolasi dengan navigasi stateful; tidak memakai layout `(app)`.
- Data berasal dari generator deterministik 120 lokasi dengan tanggal acuan tetap 28 Juli 2026.
- Regional distribution dipilih menggantikan peta karena prototype tidak boleh mengarang koordinat dan coverage koordinat produksi belum divalidasi.
- Label progress menggunakan “Dilaporkan”, “Terverifikasi”, dan “Final” tanpa mengubah counted status produksi.
- Prototype memakai memory/local browser state hanya untuk simulasi draft dan UI preference.

## Mock data

Mock meliputi:

- 120 lokasi;
- 7 provinsi, 4 perusahaan, dan 8 proyek;
- status laporan draft/dikirim/disetujui/final/belum ada;
- variasi plan, progress dilaporkan/terverifikasi/final, dan deviasi;
- issue severity, action queue, activity, owner, evidence placeholder;
- edge cases nama panjang, progress 0/100, tanpa foto/laporan/owner, deviasi ekstrem, issue banyak, dan due date lewat.

## Implementasi prototype

Prototype mencakup tujuh layar representatif:

1. Command centre dengan KPI yang dapat diklik, filter portfolio, submission monitor 120 lokasi, exception queue terpadu, distribusi wilayah, serta state loading/empty/error.
2. Location monitor dengan pencarian, multi-filter, saved-view mock, sorting, list/grid, bulk selection, dan kartu mobile.
3. Location workspace dengan health headline, progress Dilaporkan/Terverifikasi/Final, current work, blocker, keputusan, milestone, dan evidence placeholder.
4. Daily report flow lima langkah dengan validasi dekat field, draft lokal, progressive disclosure, photo mock, konfirmasi, dan success state.
5. Progress & variance dengan label level data eksplisit, visual bar yang dapat dibaca tanpa warna, lagging work, dan worst locations.
6. Action Centre sebagai antrean lintas kategori yang diurutkan berdasarkan urgensi dan dapat difilter.
7. AI Portfolio Pulse dengan source reference mock, confidence/cakupan, guardrail, serta Ask MARLIN tanpa panggilan model.

Interaksi drawer, dialog konfirmasi, dan menu mobile mendukung Escape, fokus awal, serta pemulihan fokus ke pemicu. URL `?view=` dapat direload tanpa hydration mismatch.

## Mapping ke produksi

| Prototype | Produksi sekarang |
|---|---|
| Command centre | `/`, `/aktivitas` |
| Perlu tindakan | bagian exception `/`, approval queue, `/ai/actions` |
| Location monitor | `/lokasi`, `/progress` |
| Location workspace | `/lokasi/[slug]` dan tab turunannya |
| Daily report flow | `/hari-ini`, `/lokasi/[slug]/harian/[date]` |
| Progress & variance | `/progress`, `/lokasi/[slug]/progress` |
| AI Portfolio Pulse | `/ai` |

## Validasi browser

Seluruh ukuran wajib diperiksa terhadap horizontal page overflow:

| Viewport | Hasil | Navigasi |
|---|---|---|
| 1440×900 | Lulus | rail penuh |
| 1280×800 | Lulus | rail padat |
| 1024×768 | Lulus | menu responsif |
| 768×1024 | Lulus | tombol semua menu |
| 390×844 | Lulus | bottom navigation |
| 360×800 | Lulus | bottom navigation + menu sheet |
| 320×700 | Lulus | form satu kolom + bottom navigation |

Alur manual yang diverifikasi:

- filter provinsi mengubah 120 menjadi 18 lokasi Jawa Barat;
- lokasi dapat dibuka dari submission monitor;
- exception drawer terbuka dengan fokus pada tombol tutup;
- Escape menutup drawer dan mengembalikan fokus ke exception;
- menu mobile memberi fokus awal, mendukung Escape, dan mengembalikan fokus;
- report flow berpindah langkah dan menampilkan error volume yang terhubung melalui `aria-describedby`;
- console bersih pada sesi browser baru, tidak ada Next.js issue overlay, hydration mismatch, duplicate key, atau gambar gagal dimuat;
- seluruh halaman yang diuji memiliki `scrollWidth === clientWidth`.

Smoke test Playwright:

```text
4 passed — desktop dan mobile
```

Unit test mock data:

```text
3 passed — determinisme, edge cases, dan konsistensi agregasi
```

## Bukti visual

- `docs/ui/screenshots/ui-rebuild/command-centre-desktop.png`
- `docs/ui/screenshots/ui-rebuild/command-centre-tablet.png`
- `docs/ui/screenshots/ui-rebuild/command-centre-mobile.png`
- `docs/ui/screenshots/ui-rebuild/location-workspace-desktop.png`
- `docs/ui/screenshots/ui-rebuild/daily-report-mobile.png`
- `docs/ui/screenshots/ui-rebuild/action-centre-desktop.png`

## Tidak diimplementasikan

Daftar ini akan diperbarui setelah prototype selesai:

- persistence/backend;
- permission enforcement;
- API/database/session;
- upload foto/kamera nyata;
- peta berbasis koordinat;
- formula produksi;
- offline/PWA;
- distribusi laporan;
- perubahan route produksi.

## Risiko implementasi produksi

- Scope/authorization harus diperbaiki secara terpisah; prototype bukan kontrol keamanan.
- Submission monitor memerlukan query teragregasi yang efisien untuk ratusan lokasi.
- Level progress masih menunggu keputusan bisnis di `OPEN_ISSUES.md`.
- Saved views membutuhkan model persistence bila harus lintas-device.
- Drawer dan dialog produksi harus menjadi primitive bersama dengan focus trap/inert penuh; prototype menangani fokus awal/Escape/restore tetapi belum mengunci Tab di dalam overlay.
- Mobile field flow harus dihubungkan ke idempotency, local draft, dan validasi volume existing.
- Map baru aman setelah audit kelengkapan dan akurasi koordinat.
