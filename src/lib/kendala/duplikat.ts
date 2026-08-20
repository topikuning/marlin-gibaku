/**
 * PENJAGA DUPLIKAT KENDALA — MURNI (DECISIONS 392).
 *
 * Tangkapan layar user 2026-08-20 memuat **"Lahan belum bisa clear" tiga kali**
 * — tanggal sama, tingkat sama, ketiganya terbuka. Tidak ada pemeriksaan judul
 * serupa saat mencatat, dan tidak ada cara menggabungkan.
 *
 * Tiga baris untuk satu masalah membuat hitungan "berapa kendala terbuka"
 * kehilangan arti, dan mendorong kendala lain turun dari layar.
 *
 * ### MENAWARKAN, bukan menolak
 *
 * Menolak akan membuat orang menulis judul yang sedikit berbeda supaya lolos —
 * dan duplikat yang menyamar lebih sulit dikenali daripada duplikat terang-
 * terangan. Jadi yang dilakukan: sebutkan yang mirip, biarkan orangnya
 * memutuskan.
 */

/** Normalisasi judul untuk pembandingan: huruf kecil, tanpa tanda baca, rapat. */
export function normalJudul(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kemiripan dua judul (0..1) — Dice coefficient atas bigram KARAKTER.
 *
 * Versi pertama memakai bigram KATA dan terbukti terlalu lemah untuk kalimat
 * pendek: *"lahan belum bisa clear"* vs *"lahan belum clear"* hanya
 * menghasilkan 0,40 — satu kata yang hilang sudah cukup meloloskan duplikat,
 * padahal justru bentuk itulah yang paling sering diketik orang yang mengulang
 * laporan. Ketahuan dari uji yang merah, bukan dari perkiraan.
 *
 * Bigram karakter menahan kata yang hilang DAN salah ketik sekaligus, tanpa
 * kamus apa pun. Spasi ikut dihitung sebagai karakter, jadi batas kata tetap
 * berpengaruh dan "besi" tidak diam-diam cocok dengan "bersih".
 */
export function kemiripan(a: string, b: string): number {
  const na = normalJudul(a);
  const nb = normalJudul(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigram = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const ba = bigram(na);
  const bb = bigram(nb);
  const sisa = [...bb];
  let sama = 0;
  for (const g of ba) {
    const i = sisa.indexOf(g);
    if (i >= 0) {
      sama++;
      sisa.splice(i, 1);
    }
  }
  return (2 * sama) / (ba.length + bb.length);
}

/**
 * Ambang "cukup mirip untuk ditanyakan" — DIUKUR, bukan ditebak.
 *
 * Skor nyata pada judul kendala yang benar-benar ada di sistem:
 *
 * ```
 * 1,000  Lahan belum bisa clear   VS  Lahan belum bisa clear   (duplikat asli user)
 * 0,865  Lahan belum bisa clear   VS  Lahan belum clear
 * 0,780  Material besi belum datang VS Besi belum datang
 * 0,647  Akses jalan rusak        VS  Akses jalan longsor      ← BEDA masalah
 * 0,393  Lahan belum bisa clear   VS  Relokasi pedagang belum bisa dikendalikan
 * 0,348  Lahan belum bisa clear   VS  Material besi belum datang
 * ```
 *
 * 0,7 lolos di atas "akses jalan rusak vs longsor": dua kerusakan berbeda pada
 * jalan yang sama, dan menawarkannya sebagai duplikat akan melatih orang
 * mengabaikan tawaran ini. Tawaran yang selalu diabaikan sama saja dengan tidak
 * ada.
 */
export const AMBANG_MIRIP = 0.7;

export type KandidatDuplikat = { id: string; title: string; createdAt: Date; skor: number };

/**
 * Kendala TERBUKA di lokasi yang sama dengan judul mirip.
 *
 * Lokasi sengaja jadi syarat keras: "lahan belum bisa clear" di dua desa
 * berbeda adalah dua masalah berbeda, sedekat apa pun kalimatnya.
 */
export function cariDuplikat(
  judulBaru: string,
  kandidat: { id: string; title: string; createdAt: Date }[],
  ambang = AMBANG_MIRIP,
): KandidatDuplikat[] {
  return kandidat
    .map((k) => ({ ...k, skor: kemiripan(judulBaru, k.title) }))
    .filter((k) => k.skor >= ambang)
    .sort((a, b) => b.skor - a.skor)
    .slice(0, 3);
}
