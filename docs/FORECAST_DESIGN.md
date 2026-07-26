# FORECAST (Prognosa) — Analisa & Rancangan

Status: **usulan** (belum diimplementasi). Melengkapi siklus pengendalian:
**Rencana → Aktual → Prognosa**. MARLIN saat ini punya Rencana (baseline kurva-S)
dan Aktual (realisasi), tapi **belum punya prognosa** (proyeksi ke depan).

---

## 1. Analisa: apa yang sudah ada vs yang hilang

### Sudah ada (tinggal dipakai)
- **Kurva rencana** per lokasi: `BaselinePoint.plannedPct` per minggu (kumulatif %).
- **Kurva aktual** per lokasi: realisasi tertimbang-uang = `Σ valueDone / Σ nilai RAB
  kategori`, dibucket per minggu. `getScurveSeries(locationId)` mengembalikan
  `{ planPct[], actualPct[], currentWeek, totalWeeks, grandTotal }` — `actualPct`
  `null` untuk minggu > sekarang (**inilah ekor yang diproyeksikan ke depan**).
- **Skalar progres**: `getLocationProgress → { planPct, realizedPct, deviationPct,
  realizedValue, grandTotal, weekNumber, totalWeeks }`.
- **Waktu**: kontrak `startDate/endDate`, `currentWeekNumber()`, `getPeriodBounds()`
  (punya opsi `assume` untuk skenario pra-SPMK).
- **Deviasi** `= realisasi − rencana` (titik-waktu, di `progress.ts` & `periodic-report.ts`).

### Yang HILANG (harus dibangun)
- Tidak ada logika **proyeksi/prognosa/SPI/EAC** sama sekali. Semua metrik hanya
  potret titik-waktu (rencana vs aktual + deviasi). Tak ada laju (run-rate),
  ekstrapolasi tren, atau estimasi tanggal selesai.

### Kesiapan EVM (Earned Value)
- **Dimensi JADWAL/FISIK: SIAP.** EV(t) = `valueDone` kumulatif (rupiah nilai RAB),
  PV(t) = `plannedPct × grandTotal`. SPI = EV/PV = `realizedPct / planPct`. Semua
  dalam satuan yang sama (nilai RAB, pra-PPN) → konsisten & bisa langsung dipakai.
- **Dimensi BIAYA (CPI/EAC biaya): BELUM SIAP bersih.** Kendala data:
  1. EV memakai **harga jual RAB**, sedangkan biaya aktual (`Expense`) memakai
     **biaya internal** → basisnya beda; CPI = EV/AC jadi ≈ *margin*, bukan indeks
     kinerja biaya sesungguhnya.
  2. Tidak ada **kurva anggaran biaya per-waktu** (BCWS rupiah). `BudgetLine` hanya
     total per kategori, tanpa jadwal.
  3. Tidak ada agregasi **biaya aktual per tanggal** (ACWP time-series) — `Expense.txDate`
     ada, tapi belum ada fungsi yang membucketnya per minggu.
  4. Tidak ada tautan **item RAB ↔ kategori biaya** → biaya tak bisa "diperoleh"
     di WBS yang sama dengan EV.

**Kesimpulan analisa:** forecast **jadwal/fisik** bisa dibangun sekarang, murni dari
data yang ada (sejalan prinsip "angka agregat selalu derived"). Forecast **biaya**
sebaiknya fase berikut karena butuh tambahan model data.

---

## 2. Ruang lingkup

- **v1 — Forecast Jadwal/Fisik (Prognosa Penyelesaian).** Inti pengendalian proyek &
  format KKP. Data lengkap, tanpa model baru. **Fokus dokumen ini.**
- **v2 — Forecast Biaya (Cost EAC).** Butuh: kurva anggaran biaya per-waktu (atau
  baseline biaya), fungsi ACWP-per-tanggal, opsional peta RAB↔kategori-biaya. Dibahas
  ringkas di §7.

---

## 3. Metode prognosa (jadwal/fisik)

Semua bekerja pada satuan yang sama dengan kurva (% kumulatif tertimbang-uang).

Notasi: `A` = aktual % di minggu sekarang `w`; `P` = rencana % di `w`; `N` = totalWeeks.

1. **SPI (kinerja kumulatif)** — `SPI = A / P`.
   - Durasi prognosa `= N / SPI`. Stabil, standar KKP. Mengasumsikan rasio kinerja
     rata-rata seumur proyek berlanjut.
2. **Laju terkini (run-rate)** — kecepatan `v = (A_w − A_{w−k}) / k` (%/minggu) atas
   `k` minggu terakhir (default `k = 4`).
   - Sisa minggu `= (100 − A) / v`; minggu selesai prognosa `= w + sisa`. Mencerminkan
     momentum terkini (lebih pas untuk proyek yang baru "panas").

**Keluaran headline:**
- **Prognosa tanggal selesai fisik (100%)** — `startDate + (mingguSelesai − 1)×7 hari`,
  diformat Jakarta.
- **Estimasi keterlambatan / lebih cepat** — `mingguSelesai − N` (minggu/hari).
- **Prognosa % saat akhir kontrak** (di minggu `N`) — bila < 100% = kekurangan di akhir.
- **Laju terkini vs laju dibutuhkan** — dibutuhkan `= (100 − A)/(N − w)` %/minggu.
- **Status**: `AMAN` (selesai ≤ rencana) · `WASPADA` (slip ≤ ambang) · `TELAT`
  (slip > ambang). Ambang default: 1 minggu / setara `-10` pp deviasi (selaras
  `KRITIS_THRESHOLD` dashboard).
- **Band optimis–pesimis**: garis prognosa = metode utama; area antara SPI & run-rate
  sebagai ketidakpastian.

**Kurva prognosa**: dari titik aktual terakhir (`w`, `A`) memanjang ke `mingguSelesai`
pada laju terpilih (proyeksi linear konstan; jujur karena bentuk masa depan tak diketahui).
Ditambahkan sebagai **seri ke-3** pada kurva-S.

**Ambang data minimum**: butuh ≥ 2 titik aktual (agar run-rate bermakna) dan `P > 0`.
Kurang dari itu → tampilkan "data belum cukup untuk prognosa".

---

## 4. Arsitektur (derived, tanpa model DB baru)

- **`src/lib/forecast.ts`** (baru, murni & deterministik):
  `forecastFromSeries(series: ScurveSeries, opts) → LocationForecast` di mana
  `LocationForecast = { method, spi, velocityPerWeek, requiredPerWeek, forecastFinishWeek,
  forecastFinishDate, slipWeeks, projectedPctAtEnd, status, forecastPct: (number|null)[],
  band: { optimisPct[], pesimisPct[] }, enoughData: boolean }`.
  Unit-testable penuh (patuh pola scurve/generate).
- **Perluas `ScurveSeries`** dengan `forecastPct?` (atau kembalikan terpisah) + tambah
  **polyline ke-3** di `components/knmp/scurve-chart.tsx` (mulai di `currentWeek`).
- **Gating** (reuse guard yang ada): hanya `LocationStatus === "berjalan"` (opsional
  `terhenti`), baseline `aktif` + revisi RAB `aktif`, dan data cukup. Selain itu
  prognosa disembunyikan (bukan angka menyesatkan).
- **Tidak menambah kolom agregat** — 100% dihitung on-the-fly (prinsip #4).

---

## 5. Di mana muncul

1. **Halaman Progress lokasi** `/(app)/lokasi/[slug]/progress` — **titik utama**:
   kartu **"Prognosa Penyelesaian"** (tanggal selesai, slip, status, laju terkini vs
   dibutuhkan) + kurva prognosa sebagai garis ke-3 pada `ScurveChart`.
2. **Progress portfolio** `/(app)/progress` & **Dashboard Eksekutif**
   (`deviasiRanking`) — kolom **"Prognosa selesai"** / **"Deviasi akhir prognosa"** +
   KPI **"Lokasi diprediksi telat"**.
3. **(Nanti)** Sertakan ringkas di PDF laporan mingguan & laporan eksekutif AI.

---

## 6. Verifikasi & risiko

- Unit test `forecast.ts` (SPI, run-rate, tanggal selesai, status, band, kasus data
  kurang, proyek belum mulai).
- Risiko: run-rate bisa berisik di awal → fallback ke SPI saat `k` titik belum ada;
  proyeksi linear jujur tapi bukan bentuk-S (dinyatakan jelas ke user sebagai "estimasi").

---

## 7. Forecast BIAYA (v2 — perlu tambahan data)

Agar CPI/EAC-biaya sahih, minimal butuh salah satu:
- **Kurva biaya rencana per-waktu** (BCWS): distribusikan `BudgetLine` mengikuti bobot
  kurva-S → PV-biaya per minggu. + fungsi **ACWP-per-tanggal** dari `Expense.txDate`.
  → CPI = EV-biaya/AC, EAC = BAC/CPI, ETC, proyeksi arus kas.
- Opsional lanjutan: peta **RAB-node ↔ kategori biaya** untuk CPI per item.

Versi ringan sementara (indikatif, berlabel jelas): laju belanja `Expense` terkini ×
sisa durasi vs total `BudgetLine` → "proyeksi biaya akhir" kasar. Tak menggantikan
EVM biaya penuh.
