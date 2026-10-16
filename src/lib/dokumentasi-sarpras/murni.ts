/**
 * DOKUMENTASI FOTO PER SARANA & PRASARANA – aturan murni, tanpa DB
 * (DECISIONS 683).
 *
 * Sarana/prasarana = kategori RAB tingkat 1 revisi aktif (sama dengan folder
 * "bangunan" di Drive, DECISIONS 666). Istilahnya mengikuti KKP.
 */

type FotoUrut = { tanggal: string; dibuat: number; minggu: number | null };

const HARI_MS = 24 * 3600 * 1000;
const hari = (tanggal: string) => Math.round(Date.parse(`${tanggal}T00:00:00Z`) / HARI_MS);

/** Urutan slide: tanggal laporan, lalu urutan unggah di hari yang sama. */
export function urutkanFoto<T extends { tanggal: string; dibuat: number }>(foto: T[]): T[] {
  return [...foto].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.dibuat - b.dibuat);
}

/**
 * Satu foto per minggu – yang TERAKHIR di minggu itu, karena itulah keadaan
 * paling jauh minggu tersebut. Minggu = minggu kontrak (sejak SPMK). Tanpa
 * SPMK, dikelompokkan per 7 hari sejak foto pertama, supaya ringkasannya tetap
 * ada tanpa mengarang nomor minggu.
 */
export function ringkasPerMinggu<T extends FotoUrut>(urut: T[]): T[] {
  if (urut.length === 0) return [];
  const awal = hari(urut[0].tanggal);
  const kunci = (x: T) => (x.minggu != null ? `m${x.minggu}` : `h${Math.floor((hari(x.tanggal) - awal) / 7)}`);
  const terakhir = new Map<string, T>();
  for (const x of urut) terakhir.set(kunci(x), x);
  return urut.filter((x) => terakhir.get(kunci(x)) === x);
}

/**
 * Tiga foto untuk lampiran 0% – 50% – 100%: foto pertama; foto pertama yang
 * progres sarananya pada tanggal itu sudah ≥ 50%; foto pertama yang sudah
 * tuntas. Yang belum tercapai dibiarkan KOSONG – foto lain tidak boleh
 * diakui sebagai "50%" atau "100%". Angka progres tiap foto tetap dicetak
 * apa adanya di dokumennya.
 */
export function titikDokumentasi<T extends { progres: number }>(
  urut: T[],
): { awal: T | null; tengah: T | null; akhir: T | null } {
  return {
    awal: urut[0] ?? null,
    tengah: urut.find((x) => x.progres >= 50) ?? null,
    akhir: urut.find((x) => x.progres >= 100) ?? null,
  };
}
