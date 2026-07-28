# MARLIN UI Existing Audit

Audit ini memeriksa shell, design tokens, navigasi, command centre, daftar lokasi, workspace lokasi, laporan harian, progress, keuangan, dokumen, dan AI Hub pada branch `dev`. Temuan bersifat UX/presentation; tidak mengubah aturan bisnis.

## Ringkasan

UI existing sudah mempunyai token dasar, shell responsif, bottom navigation, status primitive, focus ring, dan beberapa perbaikan overflow. Kelemahan utamanya adalah informasi portfolio masih tersebar menurut modul, bukan menurut keputusan. Eksekutif dapat melihat deviasi atau laporan menunggu review, tetapi belum memperoleh submission matrix 120+ lokasi, prioritas lintas-domain, freshness, owner, dan recommended action dalam satu scan.

## Temuan

### 1. Navigasi desktop adalah daftar 15 item tanpa grouping

**Masalah**
Semua modul tampil dalam satu daftar panjang. “Laporan”, “Laporan → WA”, “Chat Grup”, “Master Data”, dan “Sistem” mempunyai bobot visual setara dengan Beranda/Lokasi.

**Bukti halaman/komponen**
`src/components/shell/nav-config.ts` dan `src/components/shell/sidebar.tsx`.

**Dampak ke pengguna**
Pengguna harus mengingat struktur sistem; modul yang sering dipakai tidak terpisah dari administrasi.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Kelompok Ringkasan, Pelaksanaan, Komersial, Analisis, Administrasi; grup dapat collapse tanpa menambah kedalaman route.

### 2. Topbar belum menjadi alat orientasi

**Masalah**
Topbar hanya menyediakan slot breadcrumb, nama/role, dan logout. Tidak ada scope, pencarian global, freshness, atau action indicator.

**Bukti halaman/komponen**
`src/components/shell/topbar.tsx`.

**Dampak ke pengguna**
Eksekutif sulit mengetahui konteks portfolio/proyek aktif dan harus berpindah halaman untuk mencari lokasi.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Scope switcher + global search + action indicator; user menu dipadatkan.

### 3. Command centre tidak memonitor kelengkapan laporan seluruh lokasi

**Masalah**
Beranda menunjukkan laporan menunggu verifikasi/koreksi, deviasi kritis, dan kendala, tetapi tidak menjawab berapa lokasi sudah/belum melapor hari ini.

**Bukti halaman/komponen**
`src/app/(app)/page.tsx`; query mengambil pending/correction reports, bukan status harian setiap lokasi.

**Dampak ke pengguna**
Eksekutif harus membuka lokasi satu per satu untuk mengetahui lokasi yang belum submit.

**Prioritas**
Kritis untuk command centre.

**Pola solusi yang diusulkan**
Submission monitor teragregasi, searchable, dan dapat difilter dari status strip.

### 4. Exception masih dipisahkan per card/domain

**Masalah**
Laporan, koreksi, deviasi, dan issue berada di card terpisah, masing-masing diurutkan sendiri.

**Bukti halaman/komponen**
`src/app/(app)/page.tsx`.

**Dampak ke pengguna**
Tidak ada satu urutan “apa yang paling mendesak sekarang” lintas kategori.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Unified exception queue dengan severity, age, due date, owner, dan recommended action.

### 5. Status strip portfolio belum menghubungkan angka ke data pembentuk

**Masalah**
KPI cards hanya membuka halaman modul; angka tidak langsung menjadi filter konteks.

**Bukti halaman/komponen**
`src/components/ui/kpi.tsx`, `src/app/(app)/page.tsx`.

**Dampak ke pengguna**
Klik “lokasi aktif” tidak menghasilkan daftar dengan filter yang menjelaskan angka.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Metric strip bersegmen; klik metrik memperbarui daftar/queue pada halaman yang sama.

### 6. Location monitor bergantung pada data grid desktop

**Masalah**
Daftar lokasi menggunakan AG Grid; tidak ada representasi mobile yang mengutamakan status, kendala, dan satu tindakan utama.

**Bukti halaman/komponen**
`src/app/(app)/lokasi/lokasi-grid.tsx`, `src/components/grid/marlin-grid.tsx`.

**Dampak ke pengguna**
Pada mobile, scanning lokasi menjadi tabel yang dipadatkan atau perlu scroll.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Desktop location rows; mobile cards dari data sama. Saved views, grouping, dan filter chips.

### 7. Workspace lokasi membuka banyak informasi tanpa headline kesehatan

**Masalah**
KPI, chart, rencana mingguan, kendala, laporan terakhir, dan riwayat status tampil sebagai beberapa panel; “apa yang perlu dilakukan” belum menjadi summary utama.

**Bukti halaman/komponen**
`src/app/(app)/lokasi/[slug]/page.tsx`.

**Dampak ke pengguna**
PM harus menyintesis sendiri status proyek sebelum mengambil keputusan.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Health header + current work + blockers + decisions, lalu detail progresif.

### 8. Label progres belum konsisten dengan evidence level

**Masalah**
Label seperti “Terpasang” atau “Realisasi” muncul tanpa selalu menjelaskan bahwa counted status meliputi laporan baru dikirim.

**Bukti halaman/komponen**
`src/app/(app)/lokasi/[slug]/page.tsx`, `src/app/(app)/progress/page.tsx`, `src/app/(app)/keuangan/page.tsx`; juga dicatat di `docs/OPEN_ISSUES.md`.

**Dampak ke pengguna**
Pembaca dapat menyamakan progress dilaporkan dengan terverifikasi.

**Prioritas**
Kritis untuk interpretasi angka.

**Pola solusi yang diusulkan**
Label eksplisit level status + data-as-of; prototype tidak mengubah basis hitung.

### 9. Filter antarhalaman tidak konsisten

**Masalah**
Dokumen memakai form GET, grid memakai quick filter internal, halaman lain memakai kontrol berbeda.

**Bukti halaman/komponen**
`src/app/(app)/dokumen/page.tsx`, `src/components/grid/marlin-grid.tsx`, halaman AI.

**Dampak ke pengguna**
Cara menerapkan, membersihkan, dan memahami filter berubah per modul.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Filter bar bersama dengan active chips, clear, result count, dan saved view.

### 10. Tabel dokumen mempunyai terlalu banyak kolom pada mobile

**Masalah**
Sembilan kolom ditempatkan dalam `overflow-x-auto`.

**Bukti halaman/komponen**
`src/app/(app)/dokumen/page.tsx`.

**Dampak ke pengguna**
Pengguna mobile kehilangan konteks ketika scroll horizontal; tindakan utama jauh dari judul.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Desktop table dengan column priority; mobile document list/card dengan progressive detail.

### 11. Form laporan harian masih berpotensi panjang

**Masalah**
Pekerjaan, volume, enrichment, kendala, foto, dan review tersebar dalam editor besar dan form pendamping.

**Bukti halaman/komponen**
`src/app/(app)/lokasi/[slug]/harian/[date]/report-editor.tsx`, `enrichment-form.tsx`, `review-actions.tsx`.

**Dampak ke pengguna**
Mandor/mobile user harus mengelola banyak section dalam satu konteks dan sulit mengetahui kemajuan pengisian.

**Prioritas**
Kritis untuk adopsi lapangan.

**Pola solusi yang diusulkan**
Step flow 4–5 tahap, ringkasan sticky, save state jelas, review sebelum submit.

### 12. CTA primer tidak selalu tunggal

**Masalah**
Action page, links dalam cards, form controls, dan approval dapat memiliki visual weight yang mirip.

**Bukti halaman/komponen**
Page headers dan cards pada lokasi/keuangan/dokumen.

**Dampak ke pengguna**
Pengguna baru tidak yakin langkah berikutnya.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Satu primary action per konteks, secondary actions pada menu/toolbar.

### 13. Activity belum menjadi signal yang dikurasi

**Masalah**
Aktivitas tersebar pada history/status log dan halaman aktivitas, tidak selalu diprioritaskan berdasarkan dampak.

**Bukti halaman/komponen**
Workspace lokasi, aktivitas dashboard, audit/system views.

**Dampak ke pengguna**
Perubahan penting dapat tenggelam di antara log administratif.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Activity centre yang mengelompokkan event dan menyorot perubahan status/angka/kendala.

### 14. Empty/loading/error states belum menjadi bahasa sistem

**Masalah**
Primitive `EmptyState` ada, tetapi loading/error patterns tidak konsisten antarhalaman; server-rendered pages sering hanya menampilkan hasil akhir.

**Bukti halaman/komponen**
`src/components/ui/empty-state.tsx`, AG Grid overlay, berbagai halaman server.

**Dampak ke pengguna**
Pengguna sulit membedakan data kosong, filter tidak cocok, request gagal, atau data sedang dimuat.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
State component dengan copy dan recovery action yang konsisten.

### 15. Focus management baru tertutup sebagian

**Masalah**
Confirm dialog sudah focus trap; beberapa drawer memakai Escape/focus restore, tetapi primitive modal/drawer bersama belum tersedia.

**Bukti halaman/komponen**
`src/components/ui/confirm-dialog.tsx`, `use-dismissable.ts`, `docs/OPEN_ISSUES.md`.

**Dampak ke pengguna**
Keyboard/screen-reader behaviour berpotensi berbeda antar-overlay.

**Prioritas**
Tinggi untuk pattern baru.

**Pola solusi yang diusulkan**
Satu ContextDrawer/ConfirmationDialog prototype dengan title, description, Escape, focus trap, inert/backdrop, dan restore.

### 16. Tipografi padat memakai banyak ukuran arbitrer

**Masalah**
UI memakai banyak `text-[11px]`, `text-[12px]`, dan `text-[13px]`; skala belum menjadi token.

**Bukti halaman/komponen**
Shell, cards, grid, dan open issue token tipografi.

**Dampak ke pengguna**
Hierarchy dan keterbacaan mudah drift, terutama pada tablet/mobile.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Token text-xs/sm/body/title/display dengan minimum mobile yang aman.

### 17. Peta belum dapat menjadi alat keputusan utama

**Masalah**
Peta ada sebagai modul, tetapi tidak cukup bukti bahwa semua lokasi memiliki koordinat yang layak untuk command centre.

**Bukti halaman/komponen**
`/peta`, `dashboard-map.tsx`, open issues string wilayah bebas.

**Dampak ke pengguna**
Peta berisiko menjadi dekorasi atau menyesatkan karena coverage koordinat.

**Prioritas**
Sedang.

**Pola solusi yang diusulkan**
Gunakan regional distribution sampai coverage koordinat tervalidasi; map hanya bila mendukung cluster/filter/drill-down.

### 18. Jumlah klik untuk tugas lapangan masih tinggi

**Masalah**
Jalur umum adalah Hari Ini → lokasi/tanggal → editor → enrichment → kendala/foto → review/submit.

**Bukti halaman/komponen**
`src/app/(app)/hari-ini/page.tsx` dan workspace laporan harian.

**Dampak ke pengguna**
Konteks berganti beberapa kali dan completion state tidak terlihat sebagai satu flow.

**Prioritas**
Tinggi.

**Pola solusi yang diusulkan**
Single flow bertahap dengan context header persist, local save simulation, dan review step.

## Hal yang dipertahankan

- Bahasa Indonesia dan istilah lifecycle existing.
- Calculation semantics dan capability boundaries.
- Inter local, numeric tabular, focus ring, reduced motion.
- Desktop fluid container, bottom navigation mobile, dan status tone semantic.
- Exception-first intent yang sudah ada.
- Primitives yang terbukti: native controls, button, status pill, confirm pattern.
