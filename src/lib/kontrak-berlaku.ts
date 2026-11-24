/**
 * Potongan `select` Prisma untuk hari adendum kontrak (DECISIONS 773).
 *
 * Tiap kueri kontrak yang menghitung minggu, sisa hari, atau batas laporan
 * menyertakan ini, lalu memakai `akhirKontrakBerlaku` / `durasiKontrakBerlaku`
 * (progress-calc). `Contract.endDate` sendiri tetap akhir AWAL (SPMK + durasi).
 */
export const HARI_ADENDUM = { amendments: { select: { endDateDelta: true } } } as const;
