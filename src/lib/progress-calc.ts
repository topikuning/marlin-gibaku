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
