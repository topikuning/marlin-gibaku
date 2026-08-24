# UX INFORMATION ARCHITECTURE — Integrated Project Control & Assurance

> Phase 2. Design language MARLIN dipertahankan (navy primary, white cards,
> token semantik, StatusPill dari lifecycle.ts, en-dash `–` di teks UI).

## 1. Global navigation (delta `nav-config.ts`)

| Menu | Href | Capability | Catatan |
|---|---|---|---|
| Temuan | `/temuan` | `finding.view` | papan lintas lokasi, pola `/kendala` |
| Verifikasi | `/verifikasi` | `report.verify_external` | workspace Wakil PPK |
| Perlu Tindakan | `/perlu-tindakan` | `portfolio.view` | EWS manajemen + wakil |
| Kesiapan | `/kesiapan` | `package.view` | termin/PHO/FHO |

Mobile (`MOBILE_NAV`): Wakil PPK bukan `FIELD_ROLES`; ia mendapat baris generik.
Karena inspeksi adalah pekerjaan lapangan mobile, `MOBILE_NAV` diberi cabang
khusus wakil_ppk: Beranda / Verifikasi / Temuan / Lokasi.

## 2. Wakil PPK workspace — `/verifikasi`

Menjawab tiga pertanyaan halaman ringkasan (bukan kumpulan form):

1. **Bagaimana kondisi?** KPI: laporan belum diperiksa · temuan terbuka ·
   temuan menunggu verifikasi · inspeksi bulan ini.
2. **Apa masalah terpenting?** Daftar antrean: laporan harian (status
   dikirim/disetujui/final di lokasi penugasan) yang BELUM punya baris
   `ReportVerification`, urut tanggal terlama.
3. **Apa tindakan berikutnya?** Tiap baris deep-link ke
   `/lokasi/[slug]/harian/[date]` (panel verifikasi eksternal ada di sana —
   wakil melihat laporan asli yang sama, bukan salinan).

Sub-bagian (SubTabs `?bagian=`): `antrean` (default) · `inspeksi` · `temuan`.
Form inspeksi baru = halaman sendiri `/verifikasi/inspeksi/baru` (bukan modal —
form panjang + dipakai di ponsel; autofocus berurutan, tombol aksi bawah).

## 3. Papan temuan — `/temuan` (pola papan kendala)

- KPI cards (klik = filter): Terbuka · Kritis terbuka · Lewat tenggat ·
  Menunggu verifikasi · Dibuka kembali.
- Filter: status, severity, kategori, lokasi, teks.
- Kartu temuan: StatusPill (lifecycle tone), severity badge, lokasi, umur,
  tenggat, PIC, jumlah bukti; klik → `/temuan/[id]`.
- `/temuan/[id]`: header status + aksi kontekstual per capability;
  linimasa (histori status, klarifikasi, tindak lanjut) urut waktu; bukti
  (thumbnail foto via jalur foto existing + dokumen via `documentDisplayName`);
  form aksi di `Drawer`/inline sesuai ukuran.

## 4. Panel verifikasi eksternal di laporan harian

Di `/lokasi/[slug]/harian/[date]`, di bawah panel status internal, KARTU
"Verifikasi Wakil PPK" (render hanya bila `report.verify_external`):
status terkini (atau "Belum diperiksa"), riwayat, form: pilih hasil
(Diverifikasi / Perlu klarifikasi / Ditolak – perlu koreksi) + catatan (wajib
untuk dua terakhir). Pembaca lain (SM/PM) melihat status pill-nya saja (tanpa
form) supaya tahu laporannya sudah/belum diperiksa pemberi kerja.

## 5. EWS — `/perlu-tindakan`

- Tiga kolom keparahan: **Kritis / Tinggi / Sedang** (bukan badge saja).
- Kartu warning: sumber (rule id) · tanggal · objek (paket/lokasi/dokumen/
  temuan) · alasan spesifik ("Deviasi −12,4 pp terhadap rencana minggu ke-19") ·
  tindakan yang disarankan · deep-link.
- Filter paket/lokasi/kategori rule.
- Semua angka dari calculation layer; halaman tidak menghitung.

## 6. Kesiapan — `/kesiapan`

Per paket (dan per lokasi di dalamnya): tiga kartu Termin / PHO / FHO.
Setiap kartu: verdict **Siap / Siap dengan catatan / Belum siap** + daftar
alasan per syarat (✓/⚠/✗): progress terverifikasi vs ambang, milestone fase
terkait, temuan kritis terbuka, dokumen kadaluarsa. Setiap alasan deep-link ke
objeknya. Tidak ada tombol "buat termin" di v1 (OwnerBilling existing tetap
jalur input keuangan).

## 7. Hubungan dengan AI Intelligence

- `/ai/actions` (Perlu Tindakan versi AI-hub) tetap ada untuk pemegang `ai.view`;
  `/perlu-tindakan` adalah versi non-AI yang bisa diakses Wakil PPK. Keduanya
  memakai keluarga rule deterministik; kartu di `/perlu-tindakan` tidak memakai
  provider AI sama sekali.
- Ask MARLIN mendapat scope temuan (adapter) — jawaban tetap bersitasi dan
  read-only.

## 8. Mobile

- Inspeksi & temuan: layout satu kolom `max-w-xl`, tombol aksi utama full-width
  `py-4` (pola `/hari-ini`), field besar, Combobox untuk semua pilihan.
- Papan EWS & kesiapan & register: desktop-first (data padat), tetap responsif.

## 9. Empty/loading/error states

- Semua papan memakai `EmptyState` dengan kalimat yang menyebut sebabnya
  ("Belum ada temuan di lokasi penugasan Anda"), bukan layar kosong.
- Aksi memakai `useActionState` + `Banner` (sukses/galat) — konsisten.
- Wakil PPK tanpa penugasan lokasi → nol data + kalimat yang mengatakannya
  (fail-safe DECISIONS 190/199 dipertahankan).
