/**
 * Formula prestasi/bobot — MURNI, tanpa DB. SATU sumber untuk laporan periodik
 * (blanko KKP), kurva-S, dan dashboard. DECISIONS 151.
 *
 * Dua aturan yang harus dipegang bersama, dan dulu saling bertabrakan:
 *
 * 1. **Prestasi satu item tidak boleh > 100%.** Pekerjaan tidak bisa 110%
 *    selesai; blanko KKP juga tidak menyediakan angka di atas 100.
 * 2. **"s/d lalu" + "minggu ini" HARUS sama dengan "s/d".** Itu yang dibaca
 *    pengawas ketika memeriksa baris demi baris.
 *
 * Kalau pembatas 100% dipasang pada TIAP kolom secara terpisah, aturan 2 patah:
 * item dengan volume kumulatif melebihi RAB (mis. setelah adendum mengurangi
 * volume) menampilkan "lalu 50% + ini 60% = s/d 100%". Karena itu pembatas
 * hanya dipasang pada KUMULATIF, lalu kolom periode DITURUNKAN dengan
 * pengurangan — persis pola yang dipakai laporan harian (DECISIONS 147).
 */

/** Prestasi kumulatif (%) satu item, dibatasi 100%. vk ≤ 0 → 0 (bukan bagi nol). */
export function prestasiPct(volume: number, volK: number): number {
  if (!(volK > 0)) return 0;
  const p = (volume / volK) * 100;
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}

export type ItemAchievement = {
  prestasiLalu: number;
  prestasiIni: number;
  prestasiSd: number;
  bobotLalu: number;
  bobotIni: number;
  bobotSd: number;
};

/**
 * Prestasi & bobot satu baris laporan periodik.
 *
 * `prestasiIni` = prestasiSd − prestasiLalu (bukan prestasi(volIni)) sehingga
 * kolom selalu berjumlah. Efeknya jujur: item yang sudah 100% sebelum periode
 * ini menambah 0% minggu ini, walau volumenya bertambah di lapangan — volume
 * mentahnya tetap ditampilkan apa adanya di kolom volume.
 */
export function itemAchievement(input: {
  volK: number;
  volLalu: number;
  volIni: number;
  bobot: number;
}): ItemAchievement {
  const { volK, volLalu, volIni, bobot } = input;
  const prestasiLalu = prestasiPct(volLalu, volK);
  const prestasiSd = prestasiPct(volLalu + volIni, volK);
  const prestasiIni = Math.max(0, prestasiSd - prestasiLalu);
  return {
    prestasiLalu,
    prestasiIni,
    prestasiSd,
    bobotLalu: (prestasiLalu / 100) * bobot,
    bobotIni: (prestasiIni / 100) * bobot,
    bobotSd: (prestasiSd / 100) * bobot,
  };
}

/**
 * Realisasi kumulatif (%) seluruh lokasi = Σ (prestasi item × bobot item).
 *
 * Dipakai kurva-S DAN dashboard. Sengaja TIDAK memakai `valueDone` yang
 * tersimpan di laporan: nilai itu dibekukan memakai harga satuan revisi yang
 * aktif SAAT laporan dibuat, jadi begitu ada adendum yang mengubah harga,
 * angka dashboard dan angka blanko KKP berbeda tanpa ada yang salah input.
 */
export function realizedPctFromItems(
  items: { volK: number; volSd: number; bobot: number }[],
): number {
  let sum = 0;
  for (const it of items) sum += (prestasiPct(it.volSd, it.volK) / 100) * it.bobot;
  return sum;
}

/** Bobot satu item terhadap grand total (%) — 0 bila grand total tak sah. */
export function bobotPct(amount: number, grandTotal: number): number {
  if (!(grandTotal > 0)) return 0;
  const b = (amount / grandTotal) * 100;
  return Number.isFinite(b) ? b : 0;
}

/**
 * Fraksi rencana kumulatif (0..1) sebuah kategori s/d minggu ke-`week`
 * (1-based) dari matriks increment mingguannya. Dipakai kolom "Bobot Rencana"
 * blanko KKP: rencana bobot item = bobot × fraksi rencana kategorinya
 * (jadwal disimpan per kategori, bukan per item). Total 0 → 0.
 */
export function planFractionFromWeekly(weekly: number[], week: number): number {
  let total = 0;
  let cum = 0;
  for (let i = 0; i < weekly.length; i++) {
    const v = Number.isFinite(weekly[i]) ? weekly[i] : 0;
    total += v;
    if (i < week) cum += v;
  }
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, cum / total));
}

/**
 * Bagikan `target` ke n item proporsional `weights` dengan PLAFON per item
 * (`caps`), gaya waterfilling: item yang mentok plafon dipatok, sisa target
 * dibagi ulang ke item lain; bila bobot habis, sisa dibagi proporsional
 * headroom. Σ hasil = min(target, Σ caps) — dipakai kolom "Bobot Rencana"
 * blanko KKP agar JUMLAH kolom == rencana resmi kurva (satu dokumen, satu
 * angka) tanpa ada item melebihi bobotnya sendiri.
 */
export function distributeWithCaps(weights: number[], caps: number[], target: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (!(target > 0) || n === 0) return out;
  const capOf = (i: number) => Math.max(0, caps[i]);
  let remaining = Math.min(
    target,
    caps.reduce((s, c) => s + Math.max(0, c), 0),
  );
  let active = weights.map((w, i) => ({ i, w: Math.max(0, Number.isFinite(w) ? w : 0) })).filter((a) => a.w > 0);
  for (let guard = 0; guard <= n && remaining > 1e-12 && active.length > 0; guard++) {
    const sumW = active.reduce((s, a) => s + a.w, 0);
    if (!(sumW > 0)) break;
    const clipped = active.filter((a) => (a.w / sumW) * remaining >= capOf(a.i) - out[a.i] - 1e-12);
    if (clipped.length === 0) {
      for (const a of active) out[a.i] += (a.w / sumW) * remaining;
      remaining = 0;
      break;
    }
    for (const a of clipped) {
      const room = capOf(a.i) - out[a.i];
      out[a.i] += room;
      remaining -= room;
    }
    const clippedIdx = new Set(clipped.map((a) => a.i));
    active = active.filter((a) => !clippedIdx.has(a.i));
  }
  if (remaining > 1e-12) {
    const head = out.map((v, i) => capOf(i) - v);
    const sumH = head.reduce((s, h) => s + h, 0);
    if (sumH > 0) {
      const give = Math.min(remaining, sumH);
      for (let i = 0; i < n; i++) out[i] += (head[i] / sumH) * give;
    }
  }
  return out;
}

export type LaggingInput = {
  lineageKey: string;
  /** Volume kontrak item. */
  volK: number;
  /** Nilai item (rupiah) pada revisi aktif. */
  amount: number;
  /** Volume yang sudah direalisasi s/d sekarang. */
  volSd: number;
  /**
   * Fraksi rencana SELESAI item INI pada minggu berjalan (0..1) — DECISIONS 391.
   *
   * Dulu parameter ini satu angka untuk SELURUH item: fraksi kurva-S global.
   * Artinya setiap item dianggap berjalan serentak sejak minggu 1 dengan laju
   * yang sama, dan itu tidak pernah benar di konstruksi. Akibatnya di produksi:
   * *"Pekerjaan Tarik Kabel NYY"* – pekerjaan ME yang jadwalnya di ujung –
   * muncul sebagai item PALING tertinggal pada **minggu ke-3**, dengan
   * "kekurangan" 47,846 m dan Rp 6,6 jt. Padahal menurut jadwalnya sendiri ia
   * memang belum boleh dimulai.
   *
   * `0` = belum dijadwalkan minggu ini ⇒ item TIDAK bisa tertinggal, dan
   * disaring keluar. Item yang belum jatuh tempo bukan item yang terlambat;
   * menyebutnya terlambat membuat daftar ini menuntut orang mengejar pekerjaan
   * yang justru belum boleh dikerjakan.
   */
  planFrac: number;
};

export type LaggingItem = {
  lineageKey: string;
  volK: number;
  /** Volume yang SEHARUSNYA tercapai pada fraksi rencana ini. */
  expected: number;
  realized: number;
  /** Nilai rupiah dari kekurangan volume — dasar pengurutan "paling tertinggal". */
  gapValue: number;
};

/**
 * Fraksi rencana SELESAI satu item pada akhir minggu ke-N, dari jadwal yang
 * BENAR-BENAR tersimpan (DECISIONS 391).
 *
 * `weekly` adalah increment bobot per minggu milik item itu di
 * `BaselineScheduleItem` — nol berarti minggu jeda. Yang dikembalikan porsi
 * kumulatifnya terhadap total bobot item, jadi:
 *
 *   - minggu sebelum item mulai   → 0   (belum dijadwalkan, tidak bisa telat)
 *   - minggu sesudah item selesai → 1
 *
 * Mengembalikan `null` bila jadwalnya tidak ada atau kosong — pemanggil yang
 * memutuskan cadangannya. Sengaja TIDAK diam-diam jatuh ke 1 atau ke fraksi
 * global: keduanya menghasilkan angka yang terlihat sah padahal tidak berdasar.
 */
export function itemPlanFracDariJadwal(weekly: number[], weekNumber: number): number | null {
  if (!Array.isArray(weekly) || weekly.length === 0) return null;
  let total = 0;
  let sd = 0;
  for (let i = 0; i < weekly.length; i++) {
    const v = typeof weekly[i] === "number" && Number.isFinite(weekly[i]) ? weekly[i] : 0;
    total += v;
    if (i < weekNumber) sd += v;
  }
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(1, sd / total));
}

/**
 * Item yang tertinggal terhadap fraksi rencana (0..1) — dipakai panel
 * "paling tertinggal" di halaman Progress.
 *
 * Nilai kekurangan sengaja dihitung dari `amount` (nilai item pada revisi
 * aktif) × porsi volume yang kurang, BUKAN dari harga satuan. Harga satuan
 * boleh kosong di RAB hasil impor, dan menambalnya dengan `amount / volume`
 * berarti mengarang angka yang tidak ada di dokumen RAB (audit 2026-07-27, M6).
 */
export function laggingItems(items: LaggingInput[], limit = 10): LaggingItem[] {
  return items
    .filter((it) => it.volK > 0 && it.planFrac > 0)
    .map((it) => {
      const expected = it.volK * Math.min(1, it.planFrac);
      const shortfall = Math.max(0, expected - it.volSd);
      return {
        lineageKey: it.lineageKey,
        volK: it.volK,
        expected,
        realized: it.volSd,
        gapValue: (shortfall / it.volK) * Math.max(0, it.amount),
      };
    })
    .filter((it) => it.realized < it.expected - 1e-9)
    .sort((a, b) => b.gapValue - a.gapValue)
    .slice(0, limit);
}


/**
 * Agregat progress banyak lokasi = rata-rata TERTIMBANG grandTotal
 * (audit 2026-07-27, B13 — sebelumnya di-fork 4× dengan penanganan div-0 dan
 * pembulatan yang berbeda-beda, termasuk varian BigInt yang memotong desimal).
 * Ini SATU-SATUNYA tempat rumusnya ditulis; dipakai dashboard, halaman
 * Progress, halaman Paket, dan gate transisi serah_terima.
 */
export function weightedRealizedPct(rows: { grandTotal: bigint; realizedValue: bigint }[]): number {
  let grand = 0n;
  let realized = 0n;
  for (const r of rows) {
    grand += r.grandTotal;
    realized += r.realizedValue;
  }
  if (grand <= 0n) return 0;
  return (Number(realized) / Number(grand)) * 100;
}

/** Rata-rata tertimbang deret persen apa pun (mis. planPct) dgn bobot grandTotal. */
export function weightedPct(rows: { grandTotal: bigint; pct: number }[]): number {
  let grand = 0;
  let acc = 0;
  for (const r of rows) {
    const w = Number(r.grandTotal);
    grand += w;
    acc += r.pct * w;
  }
  return grand > 0 ? acc / grand : 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PERIODE MINGGU LAPORAN (user 2026-08-24) — MURNI, tanpa DB.
 *
 * Dua cara menghitung "minggu ke-n" sejak SPMK, dipilih per kontrak
 * (`Contract.weekMode`):
 *
 * - `tujuh_hari` (default, perilaku lama): minggu ke-n = [SPMK + (n−1)×7 hari,
 *   +6 hari]. Semua minggu 7 hari; hari mulainya mengikuti hari SPMK.
 * - `senin_minggu`: minggu KALENDER Senin–Minggu. Minggu pertama bisa pendek:
 *   SPMK hari Kamis ⇒ M1 = Kamis–Minggu (4 hari). Minggu terakhir juga bisa
 *   pendek bila kontrak berakhir sebelum hari Minggu.
 *
 * Semua tanggal di sini adalah TANGGAL KERJA @db.Date (UTC-midnight), jadi
 * `getUTCDay()` adalah hari kalender tanggal itu — bukan hari di zona lain.
 * Deret baseline kurva-S TIDAK ditafsirkan ulang: titik ke-n tetap "akhir
 * minggu ke-n"; yang berubah hanya tanggal kalender batas minggunya.
 * ──────────────────────────────────────────────────────────────────────────── */

export type WeekPeriodMode = "tujuh_hari" | "senin_minggu";

const DAY_MS = 24 * 3600 * 1000;

/** Senin (UTC-midnight) pada minggu kalender yang memuat `d`. */
function seninPekan(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // Senin=0 … Minggu=6
  return new Date(d.getTime() - dow * DAY_MS);
}

/**
 * Minggu ke berapa `date` jatuh, dihitung dari `start` menurut `mode`.
 * 0 = sebelum mulai. TIDAK di-clamp ke total minggu — pemanggil yang tahu
 * batasnya (lihat `currentWeekNumber` di progress.ts).
 */
export function weekOfDate(start: Date, date: Date, mode: WeekPeriodMode): number {
  // Sebelum SPMK = belum mulai (DECISIONS 202) — juga pada mode kalender,
  // walau tanggalnya berada di minggu Senin–Minggu yang sama dengan SPMK.
  if (date.getTime() < start.getTime()) return 0;
  if (mode === "senin_minggu") {
    return Math.floor((seninPekan(date).getTime() - seninPekan(start).getTime()) / (7 * DAY_MS)) + 1;
  }
  return Math.floor((date.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
}

/** Jumlah minggu (kolom M) yang menutup [start, end] menurut `mode`. Min 1. */
export function totalWeeksBetween(start: Date, end: Date, mode: WeekPeriodMode): number {
  if (end.getTime() < start.getTime()) return 1;
  return Math.max(1, weekOfDate(start, end, mode));
}

/**
 * Rentang tanggal minggu ke-n (date-only, UTC-midnight).
 * Awal M1 selalu = `start` (mode kalender: M1 pendek). Bila `end` diberikan,
 * akhir minggu terakhir dipangkas ke `end`.
 */
export function weekDateRange(
  start: Date,
  n: number,
  mode: WeekPeriodMode,
  end?: Date | null,
): { start: Date; end: Date } {
  let s: Date;
  let e: Date;
  if (mode === "senin_minggu") {
    const senin1 = seninPekan(start);
    s = new Date(senin1.getTime() + (n - 1) * 7 * DAY_MS);
    e = new Date(s.getTime() + 6 * DAY_MS);
    if (s.getTime() < start.getTime()) s = start; // M1 pendek
  } else {
    s = new Date(start.getTime() + (n - 1) * 7 * DAY_MS);
    e = new Date(s.getTime() + 6 * DAY_MS);
  }
  if (end && e.getTime() > end.getTime() && end.getTime() >= s.getTime()) e = end;
  return { start: s, end: e };
}
