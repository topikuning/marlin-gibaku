# MARLIN UI Rebuild — Design Contract

Status: diterapkan bertahap pada branch `devCodex`; keputusan dan batas produksi dicatat di `UI_REBUILD_PRODUCTION_IMPLEMENTATION.md`.

## 1. Experience principles

1. **Exception-first.** Tindakan, keterlambatan, kendala, dan data yang hilang muncul sebelum ringkasan administratif.
2. **Action-oriented.** Setiap status bermasalah menjelaskan penanggung jawab, umur masalah, solusi yang diusulkan, dan tindakan berikutnya.
3. **Context-preserving.** Pengguna selalu dapat melihat scope portfolio/proyek/lokasi, periode data, dan status data.
4. **Dense but readable.** Kepadatan berasal dari hierarchy, grouping, dan progressive disclosure; bukan teks kecil.
5. **One source of numbers.** Prototype hanya menampilkan mock yang sudah dihitung. Implementasi produksi wajib memakai calculation layer kanonik.
6. **Evidence-aware.** Progress harus dilabeli Dilaporkan, Terverifikasi, atau Final. Warna tidak boleh menjadi satu-satunya penanda.
7. **Desktop command centre, mobile field tool.** Desktop mengoptimalkan scan lintas ratusan lokasi; mobile mengoptimalkan satu tugas lapangan.
8. **One primary action per context.** Tindakan sekunder tidak bersaing secara visual.
9. **Progressive disclosure.** Ringkasan menjawab “apa yang terjadi”; drawer/workspace menjawab “mengapa dan apa berikutnya”.
10. **Operational, not promotional.** Tidak ada hero, slogan, chart dekoratif, glassmorphism, atau card soup.

## 2. Information architecture

Navigasi maksimum dua tingkat dan dikelompokkan menurut pekerjaan.

```text
Ringkasan
├─ Command centre
└─ Perlu tindakan

Pelaksanaan
├─ Lokasi
├─ Laporan lapangan
├─ Progress
├─ Kendala
└─ Foto

Komersial
├─ RAB & BOQ
├─ Keuangan
├─ Termin & tagihan
└─ Dokumen

Analisis
├─ Laporan
└─ AI Hub

Administrasi
├─ Kontrak
├─ Personel
└─ Pengaturan
```

Kelompok boleh disaring berdasarkan capability, tetapi label dan urutan tidak berubah antar-role tanpa alasan tugas yang jelas.

## 3. Navigation contract

- Desktop memakai rail 272 px yang dapat dipadatkan; kelompok aktif jelas dan jumlah item per kelompok dibatasi.
- Topbar memuat scope switcher, pencarian global, action indicator, dan konteks user.
- Mobile memakai empat tujuan utama dan tombol “Menu”; tujuan utama mengikuti peran.
- Breadcrumb/context path muncul pada workspace dan tidak menggantikan judul halaman.
- Drill-down membuka drawer untuk inspeksi cepat; navigasi penuh dipakai saat tugas membutuhkan workspace.
- Tombol back browser tetap bermakna pada implementasi produksi.

## 4. Visual hierarchy

Urutan halaman command centre:

1. scope, periode, freshness, dan filter;
2. status strip operasional yang dapat diklik;
3. submission monitor;
4. exception queue;
5. regional distribution;
6. activity centre.

Aturan:

- Maksimal satu heading `h1`.
- Angka besar hanya untuk metrik yang mengubah keputusan.
- Status strip adalah satu permukaan bersegmen, bukan enam kartu lepas.
- Border dan whitespace menjadi pemisah utama; shadow hanya untuk overlay.
- Teks metadata minimum 12 px desktop dan 13 px mobile.
- Numeric data memakai tabular numerals.

## 5. Responsive behaviour

### Desktop ≥ 1200 px

- Rail tetap; konten fluid sampai 1720 px.
- Command centre menggunakan grid 12 kolom.
- Exception queue dan detail drawer dapat terlihat bersamaan.
- Data location monitor berbentuk row hierarchy, bukan kartu KPI berulang.

### Tablet 768–1199 px

- Rail menjadi compact/overlay.
- Filter membungkus atau masuk sheet.
- Grid 12 kolom turun menjadi 6.
- Drawer maksimum 70vw dan tidak memotong chart.

### Mobile < 768 px

- Header ringkas dan bottom navigation.
- Exception dan primary action berada paling atas.
- Location rows berubah menjadi cards; tidak ada tabel desktop yang diperkecil.
- Padding horizontal 16 px (12 px pada 320 px bila diperlukan).
- Target sentuh minimum 44 × 44 px.
- Form laporan berbasis langkah dan mempunyai sticky action bar.
- Tidak boleh ada horizontal overflow pada 320 px.

## 6. Component principles

Komponen prototype:

- `PrototypeAppShell`: shell dan responsive navigation.
- `ScopeSwitcher`: portfolio/proyek/provinsi.
- `StatusBadge`: ikon/teks + tone semantik.
- `MetricStrip`: metrik terhubung ke filter.
- `FilterBar`: filter aktif, clear, dan saved view.
- `ExceptionItem`: severity, context, owner, age, recommendation.
- `LocationRow` / `LocationCard`: representasi desktop/mobile dari data yang sama.
- `ActivityItem`: event bermakna, bukan raw log.
- `ContextDrawer`: detail cepat, Escape, focus restore.
- `EmptyState`, `ErrorState`, `LoadingState`: state eksplisit.
- `FormSection`: langkah laporan dengan validation dekat field.
- `ConfirmationDialog`: konfirmasi submit/destructive action dengan focus management.

Jangan mengekstrak primitive generik sampai pola benar-benar berulang.

## 7. Prototype design tokens

| Token | Nilai |
|---|---|
| Font | Inter local, fallback system UI |
| Base text | 14 px / 1.5 desktop; 16 px control mobile |
| Display | 28/34 px desktop; 22/28 px mobile |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40 |
| Radius | 6 control, 10 panel, 14 overlay |
| Border | 1 px neutral; 2 px selected/focus |
| Elevation | none untuk content; medium untuk drawer/dialog |
| Control height | 40 px desktop, 44 px mobile |
| Icon | 16 px inline, 20 px navigation, 24 px primary |
| Container | fluid, max 1720 px |
| Mobile padding | 16 px; 12 px pada viewport 320 px |
| Focus ring | 3 px cyan/blue dengan offset 2 px |

Semantic tones selalu memuat teks:

- critical: merah gelap + “Kritis”;
- warning: amber + “Perlu perhatian”;
- healthy: hijau + “Terkendali”;
- info: biru + label netral;
- offline/stale: abu-abu + timestamp/freshness.

## 8. Accessibility contract

- Semantic landmarks (`header`, `nav`, `main`, `aside`, `footer`).
- Heading berurutan dan nama landmark unik.
- Semua control memakai button/link native.
- Visible focus untuk seluruh interactive element.
- Drawer/dialog: title, description, `aria-modal`, Escape, focus containment, dan focus restore.
- Field mempunyai label eksplisit; error memakai `aria-invalid` dan `aria-describedby`.
- Feedback penting memakai `aria-live`.
- Status tidak bergantung pada warna.
- Contrast target WCAG AA.
- `prefers-reduced-motion` dihormati.
- Tab order mengikuti urutan visual.
- Target sentuh minimum 44 px pada mobile.

## 9. Status and number semantics

- Jangan gunakan label tunggal “Realisasi”.
- Gunakan “Progress Dilaporkan” untuk mock level counted saat ini.
- “Progress Terverifikasi” dan “Progress Final” hanya ditampilkan bila mock menyediakannya.
- Setiap panel angka menampilkan scope, periode/data-as-of, dan status data.
- Deviasi selalu `actual − plan`, satuan percentage points.
- Prototype tidak mengubah formula, status counted, lifecycle, atau permission.
- AI tidak membuat angka; angka AI harus mempunyai sumber, periode, scope, dan drill-down.

## 10. Acceptance criteria

Prototype diterima untuk review desain bila:

- route hanya aktif dengan `ENABLE_UI_PROTOTYPE=true`;
- tidak mengakses session, database, server action, storage, atau API produksi;
- mempunyai 120+ lokasi mock deterministik dan edge cases;
- command centre, location monitor/workspace, report flow, progress, action centre, dan AI representatif dapat dinavigasi;
- KPI, search, filter, saved view, selection, drawer, form, validation, save/submit simulation bekerja;
- loading, error, empty, dan success state tersedia;
- Escape menutup drawer/dialog dan fokus kembali;
- 1440, 1280, 1024, 768, 390, 360, dan 320 px tidak overflow horizontal;
- screenshot minimum tersimpan;
- typecheck, lint, unit, build, dan browser smoke validation dilaporkan jujur;
- halaman produksi, backend, formula, permission, dan lifecycle tidak berubah;
- prototype tidak dinyatakan siap produksi.
