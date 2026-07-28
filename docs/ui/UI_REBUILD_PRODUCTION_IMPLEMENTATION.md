# MARLIN UI Rebuild — Production Implementation

Status: diterapkan pada branch `devCodex`; belum digabung ke `dev`.

## Prinsip integrasi

Implementasi ini memindahkan keputusan desain prototype ke route produksi tanpa mengganti:

- session dan permission;
- organization/location scope;
- lifecycle laporan;
- calculation layer progress;
- server action;
- database model;
- formula keuangan;
- format dokumen resmi.

Prototype `/prototype/ui-rebuild` tetap dipertahankan sebagai referensi dan alat perbandingan.

## Yang sudah diterapkan

### Shell aplikasi

- rail desktop 272 px dengan mode padat 80 px;
- navigasi dikelompokkan menjadi Ringkasan, Pelaksanaan, Komersial, Analisis, dan Administrasi;
- item tetap disaring oleh capability sebelum mencapai shell;
- topbar berisi konteks halaman, pencarian tujuan, shortcut `/`, pusat tindakan, dan menu pengguna;
- mobile navigation mempertahankan empat shortcut berbasis role serta grouped full-menu sheet;
- container produksi diperlebar hingga 1720 px;
- focus ring, token warna, surface, border, dan semantic tones mengikuti design contract.

### Command Centre

- heading menjadi kondisi operasional, bukan sapaan/promosi;
- status utama memakai satu segmented metric strip;
- setiap metrik menuju sumber data produksi;
- submission, deviasi, verifikasi, koreksi, finance, map, issue, dan activity tetap berasal dari `getDashboardData`;
- metrik administrasi diturunkan satu tingkat setelah exception.

### Action Centre

Route baru `/tindakan` menggabungkan:

- issue terbuka;
- laporan menunggu review;
- laporan yang perlu koreksi.

Urutan didasarkan pada severity dan jenis tindakan. Penyelesaian tetap dilakukan pada workspace sumber agar permission dan lifecycle tidak diduplikasi.

### Location Monitor

- desktop tetap memakai `MarlinGrid`, batch progress query, CSV, saved grid preference, dan data scope produksi;
- mobile memakai card hierarchy khusus, bukan tabel yang diperkecil;
- pencarian dan filter status berjalan lokal terhadap data scoped dari server;
- label “Dilaporkan” menggantikan “Realisasi” untuk level progress yang dihitung saat ini;
- summary strip menampilkan total, berjalan, perlu perhatian, dan deviasi kritis.

### Location Workspace

- identitas lokasi, status, paket, vendor, kontrak, periode, progress, deviasi, dan minggu aktif ditempatkan dalam operational hero;
- tab dan semua route turunannya tetap sama;
- rename location masih memakai server action dan capability existing;
- label progress menjadi “Progress Dilaporkan”.

### Progress semantics

Label pada portfolio progress, location progress, S-curve UI, dan dashboard dibedakan sebagai “Dilaporkan”. Istilah “Realisasi” tetap dipertahankan pada finance dan blanko resmi ketika maknanya memang realisasi biaya atau terminologi dokumen kontraktual.

## Keputusan yang belum diklaim selesai

- Tidak ada level Terverifikasi/Final baru karena calculation layer produksi belum menyediakannya sebagai seri terpisah.
- Topbar mencari tujuan/menu; pencarian lokasi produksi tetap memakai `DashboardSearch` dan filter Location Monitor.
- Action Centre belum mempunyai bulk assignment karena belum ada model ownership lintas jenis tindakan.
- Overlay user bukan dialog modal; Escape didukung, tetapi focus trap hanya relevan untuk mobile menu/dialog.
- Daily report mempertahankan editor produksi yang sudah mobile-first dan idempotent. Flow visual lima langkah prototype belum mengganti transaksi produksi karena penyimpanan item dilakukan bertahap melalui server action.

## Validasi wajib sebelum merge

- lint;
- typecheck;
- unit navigation dan prototype;
- production build;
- browser session dengan database test;
- role matrix untuk super admin, management, site manager, dan field supervisor;
- 1440, 1024, 768, 390, 360, dan 320 px;
- tidak ada page-level horizontal overflow;
- tidak ada perubahan angka dibanding calculation layer sebelum redesign.

## Area jawaban / challenge

> Reviewer/Claude dapat menulis sanggahan di bawah ini.

**Apakah mapping route ke kelompok navigasi sudah tepat?**

Jawaban/challenge:

**Apakah `/tindakan` seharusnya tersedia untuk Site Manager tanpa `portfolio.view`?**

Jawaban/challenge:

**Apakah editor laporan produksi perlu dipaksa menjadi wizard lima langkah walaupun setiap item disimpan idempotent secara terpisah?**

Jawaban/challenge:

**Apakah progress Terverifikasi dan Final perlu calculation series baru sebelum ditampilkan?**

Jawaban/challenge:
