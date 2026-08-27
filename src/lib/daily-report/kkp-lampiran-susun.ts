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

/* ─────────────── TATA LETAK KARTU DOKUMENTASI (2026-08-27) ────────────────
 *
 * Keluhan user atas berkas 26 Agustus 2026: *"foto juga susunannya
 * berantakan."* Halaman dokumentasinya memuat dua kartu berdampingan — yang
 * kiri berisi satu foto, yang kanan dua — lalu berhenti, menyisakan setengah
 * lembar kosong di bawahnya. Empat kartu memakan dua lembar yang keduanya
 * setengah terisi.
 *
 * Dua sebabnya, dan keduanya ada di sini:
 *
 * 1. **Barisnya kaku.** Kartu dipasangkan dua-dua, dan tinggi barisnya
 *    ditentukan kartu yang paling banyak fotonya. Kartu pasangannya yang lebih
 *    pendek meninggalkan lubang, dan lubang itu tidak pernah terpakai.
 * 2. **Tinggi fotonya dipatok 150 pt.** Dua kartu berisi dua foto membutuhkan
 *    792 pt sekolom, sementara kolomnya 782 pt — meleset SEPULUH POIN, dan
 *    karena itu kartu kedua terlempar ke lembar berikutnya.
 *
 * Jawabannya dua fungsi MURNI di bawah: satu memilih tinggi foto sebesar
 * mungkin yang masih membuat tumpukannya muat, satu lagi menempatkan kartu ke
 * kolom yang paling pendek (bukan ke pasangan tetap) sehingga kedua kolom
 * berakhir sejajar dan tidak ada lubang.
 *
 * Keduanya ditaruh di modul MURNI ini, bukan di penyaji pdfkit, supaya bisa
 * diuji tanpa menggambar apa pun — dan supaya halaman cetak HTML punya satu
 * tempat yang sama untuk diikuti bila kelak perlu menyamakan susunannya.
 * (Hari ini HTML masih mengalir sendiri lewat CSS; yang wajib sama antara
 * keduanya adalah `susunKartu`, dan itu memang dipakai bersama.)
 */

/** Tinggi kepala kartu: kop pelaksana + judul + dua baris identitas. */
export const TINGGI_KEPALA_KARTU = 30 + 3 * 14;
/** Tinggi baris judul di atas tiap foto (dokumentasi pekerjaan). */
export const TINGGI_JUDUL_FOTO = 12;
/** Jarak tegak antar kartu dalam satu kolom. */
export const JARAK_KARTU = 10;
/** Tinggi foto terbesar — di atas ini kartunya melar tanpa menambah kejelasan. */
export const TINGGI_FOTO_MAKS = 150;
/**
 * Batas bawah pengecilan foto DEMI MENGHEMAT LEMBAR.
 *
 * Mengecilkan foto supaya satu kartu lagi muat itu sepadan selama fotonya
 * masih bisa dinilai. Di bawah ±120 pt (±4 cm) foto lapangan sudah tidak bisa
 * dipakai memeriksa pekerjaan, dan menghemat kertas dengan cara itu berarti
 * membuang gunanya dokumentasi.
 */
export const TINGGI_FOTO_MIN = 120;

/** Tinggi satu kartu berisi `banyakFoto` foto. */
export function tinggiKartu(
  banyakFoto: number,
  tinggiFoto: number,
  tinggiJudulFoto = TINGGI_JUDUL_FOTO,
): number {
  return TINGGI_KEPALA_KARTU + banyakFoto * (tinggiJudulFoto + tinggiFoto);
}

/**
 * Tinggi foto untuk SELURUH blok dokumentasi — satu angka, supaya semua foto
 * di berkas itu seukuran.
 *
 * Aturannya: sebesar mungkin, dikecilkan HANYA selama pengecilan itu membuat
 * satu kartu tambahan muat dalam satu kolom, dan tidak pernah di bawah
 * `TINGGI_FOTO_MIN`.
 */
export function tinggiFotoDokumentasi(
  banyakFotoTiapKartu: number[],
  tinggiKolom: number,
  tinggiJudulFoto = TINGGI_JUDUL_FOTO,
): number {
  const nMaks = Math.max(1, ...banyakFotoTiapKartu);
  // Kartu terakhir sekolom tidak butuh jarak di bawahnya; menambahkannya di
  // kedua ruas membuat pembagiannya jadi sederhana.
  const ruang = tinggiKolom + JARAK_KARTU;
  const muat = (h: number) =>
    Math.max(1, Math.floor(ruang / (tinggiKartu(nMaks, h, tinggiJudulFoto) + JARAK_KARTU)));
  // Lebih dari ini tidak ada gunanya: tumpukan yang tak akan pernah terisi.
  const perlu = Math.max(1, Math.ceil(banyakFotoTiapKartu.length / 2));

  let tinggi = TINGGI_FOTO_MAKS;
  while (muat(tinggi) < perlu) {
    const n = muat(tinggi) + 1;
    const h = Math.floor((ruang / n - JARAK_KARTU - TINGGI_KEPALA_KARTU) / nMaks - tinggiJudulFoto);
    if (h < TINGGI_FOTO_MIN) break;
    tinggi = h;
  }
  // Apa pun hasil di atas, satu kartu TIDAK BOLEH lebih tinggi dari kolomnya —
  // kartu yang melimpah digambar menembus tepi kertas, dan itu justru cacat
  // yang sedang diperbaiki.
  const batas = Math.floor((tinggiKolom - TINGGI_KEPALA_KARTU) / nMaks) - tinggiJudulFoto;
  return Math.max(1, Math.min(tinggi, batas));
}

export type LetakKartu = {
  /** Nomor halaman blok dokumentasi, mulai 0. */
  halaman: number;
  /** 0 = kolom kiri, 1 = kolom kanan. */
  kolom: 0 | 1;
  /** Jarak dari tepi ATAS daerah cetak. */
  y: number;
};

/**
 * Tempatkan kartu ke dua kolom yang MENGALIR: tiap kartu jatuh ke kolom yang
 * saat itu paling pendek, bukan ke pasangan tetap. Halaman baru hanya ketika
 * kartunya tidak muat di kolom terpendek — dan bila di situ tidak muat, di
 * kolom yang lebih panjang pun pasti tidak.
 */
export function taruhDuaKolom(tinggiTiapKartu: number[], tinggiKolom: number): LetakKartu[] {
  const letak: LetakKartu[] = [];
  let halaman = -1;
  let kolomY: [number, number] = [0, 0];
  for (const tinggi of tinggiTiapKartu) {
    let kolom: 0 | 1 = kolomY[0] <= kolomY[1] ? 0 : 1;
    if (halaman < 0 || kolomY[kolom] + tinggi > tinggiKolom) {
      halaman += 1;
      kolomY = [0, 0];
      kolom = 0;
    }
    letak.push({ halaman, kolom, y: kolomY[kolom] });
    kolomY[kolom] += tinggi + JARAK_KARTU;
  }
  return letak;
}
