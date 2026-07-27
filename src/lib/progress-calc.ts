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
 * Item yang tertinggal terhadap fraksi rencana (0..1) — dipakai panel
 * "paling tertinggal" di halaman Progress.
 *
 * Nilai kekurangan sengaja dihitung dari `amount` (nilai item pada revisi
 * aktif) × porsi volume yang kurang, BUKAN dari harga satuan. Harga satuan
 * boleh kosong di RAB hasil impor, dan menambalnya dengan `amount / volume`
 * berarti mengarang angka yang tidak ada di dokumen RAB (audit 2026-07-27, M6).
 */
export function laggingItems(items: LaggingInput[], planFraction: number, limit = 10): LaggingItem[] {
  if (!(planFraction > 0)) return [];
  const frac = Math.min(1, planFraction);
  return items
    .filter((it) => it.volK > 0)
    .map((it) => {
      const expected = it.volK * frac;
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
