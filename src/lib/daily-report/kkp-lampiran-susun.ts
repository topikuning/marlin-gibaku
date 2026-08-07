/**
 * Susunan SAMPUL & DOKUMENTASI laporan harian KKP — bagian yang tidak
 * menggambar apa pun.
 *
 * Dipisah dari `lib/pdf/harian-kkp-lampiran.ts` karena halaman cetak HTML
 * (`/cetak/harian`) memerlukan susunan yang SAMA PERSIS, sedangkan modul PDF
 * memuat pdfkit saat impor dan tidak boleh ikut tertarik ke bundel React.
 *
 * Aturannya sama seperti baris rencana/realisasi (DECISIONS 241): kalau PDF dan
 * layar menyusun kartunya sendiri-sendiri, cepat atau lambat keduanya
 * menyimpang — dan yang ketahuan belakangan justru setelah dokumennya dikirim.
 */

/** Angka minggu jadi terbilang: "MINGGU KE-2 (DUA)" seperti contoh KKP. */
const TERBILANG = [
  "NOL", "SATU", "DUA", "TIGA", "EMPAT", "LIMA", "ENAM", "TUJUH", "DELAPAN",
  "SEMBILAN", "SEPULUH", "SEBELAS", "DUA BELAS", "TIGA BELAS", "EMPAT BELAS",
  "LIMA BELAS", "ENAM BELAS", "TUJUH BELAS", "DELAPAN BELAS", "SEMBILAN BELAS",
  "DUA PULUH",
];

export function terbilang(n: number): string | null {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n <= 20) return TERBILANG[n];
  if (n < 100) {
    const p = Math.floor(n / 10);
    const s = n % 10;
    return `${TERBILANG[p]} PULUH${s ? ` ${TERBILANG[s]}` : ""}`;
  }
  return null; // di atas 99 tidak pernah terjadi untuk nomor minggu proyek
}

/** Maksimal foto per kartu — 3 seperti contoh, supaya tiap foto masih terbaca. */
export const FOTO_PER_KARTU = 3;

/**
 * Kelompokkan foto per PEKERJAAN, lalu pecah tiap kelompok jadi kartu berisi
 * maksimal 3 foto. Foto tanpa item tetap dicetak di kartu tersendiri — bukti
 * yang tidak tertaut pekerjaan tetap bukti, dan menghilangkannya diam-diam
 * membuat orang mengira fotonya tidak terunggah.
 */
export function susunKartu<T extends { pekerjaan: string | null }>(foto: T[]): T[][] {
  const grup = new Map<string, T[]>();
  for (const f of foto) {
    const kunci = f.pekerjaan ?? " tanpa-item";
    const arr = grup.get(kunci) ?? [];
    arr.push(f);
    grup.set(kunci, arr);
  }
  const kartu: T[][] = [];
  for (const arr of grup.values())
    for (let i = 0; i < arr.length; i += FOTO_PER_KARTU) kartu.push(arr.slice(i, i + FOTO_PER_KARTU));
  return kartu;
}
