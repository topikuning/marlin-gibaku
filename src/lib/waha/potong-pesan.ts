/**
 * PEMOTONG PESAN PANJANG — kirim bertahap, bukan dipotong (DECISIONS 390).
 *
 * MURNI: tanpa DB, tanpa jaringan.
 *
 * ### Kenapa ini ada
 *
 * Keberatan user 2026-08-20, dengan tangkapan layar produksi:
 *
 * > *"kenapa cuma batasi 15, kalau pun harus dikirim bertahap, ya buat
 * > bertahap beberapa pesan"*
 *
 * Sebelumnya daftar panjang dipangkas di baris ke-15 dan sisanya diganti
 * kalimat *"Ditampilkan 15 dari 54 lokasi belum beres. Selengkapnya buka
 * MARLIN."* Jujur — tapi menjawab setengah. Orang yang bertanya "siapa yang
 * belum lapor" justru butuh daftar LENGKAPnya untuk ditindaklanjuti, dan
 * menyuruhnya membuka aplikasi meniadakan alasan ia bertanya lewat WhatsApp.
 *
 * ### Bagaimana memotongnya
 *
 * Potongan HANYA di batas baris. Memotong di tengah baris menghasilkan
 * "Kedung Muti" di ujung pesan pertama dan "h – Belum ada laporan" di awal
 * pesan kedua; pembacanya tidak akan tahu itu satu lokasi.
 *
 * Satu baris yang sendirian melebihi batas TIDAK dipecah — ia dikirim utuh
 * sebagai satu pesan yang kelebihan. Memecahnya di tengah kata lebih buruk
 * daripada satu pesan yang agak panjang, dan baris sepanjang itu di MARLIN
 * hanya lahir dari kutipan catatan lapangan yang memang harus verbatim.
 *
 * ### Kepala & penanda bagian
 *
 * Setiap potongan diberi penanda `(bagian n/m)`. Tanpa itu, potongan kedua
 * yang tiba-tiba dimulai dengan nama lokasi terbaca sebagai balasan baru —
 * apalagi di grup ramai tempat pesan lain menyela di antaranya.
 */

/** Panjang aman satu pesan WhatsApp. Jauh di bawah batas protokol; yang
 *  membatasi di sini keterbacaan di layar ponsel, bukan protokolnya. */
export const BATAS_PESAN = 1400;

/**
 * Berapa pesan paling banyak untuk SATU jawaban.
 *
 * Bukan soal teknis melainkan sopan santun di grup: 30 pesan beruntun dari
 * bot membuat percakapan manusia terdorong hilang dari layar. Kalau masih
 * lebih, sisanya diakui — dan pengakuan itu wajib, karena daftar yang dipotong
 * diam-diam terbaca sebagai daftar lengkap.
 */
export const MAKS_POTONGAN = 8;

export type HasilPotong = {
  /** Pesan siap kirim, berurutan. Selalu minimal satu. */
  bagian: string[];
  /** Baris yang tetap tidak muat setelah MAKS_POTONGAN. 0 = semuanya masuk. */
  sisaBaris: number;
};

/**
 * Pecah satu balasan panjang menjadi beberapa pesan.
 *
 * @param teks     balasan utuh (sudah berisi kepala & kaki)
 * @param batas    panjang maksimum per pesan
 * @param maks     jumlah pesan maksimum
 */
export function potongPesan(
  teks: string,
  batas: number = BATAS_PESAN,
  maks: number = MAKS_POTONGAN,
): HasilPotong {
  if (teks.length <= batas) return { bagian: [teks], sisaBaris: 0 };

  const baris = teks.split("\n");
  const potongan: string[] = [];
  let kini = "";

  for (const b of baris) {
    const calon = kini ? `${kini}\n${b}` : b;
    if (calon.length <= batas) {
      kini = calon;
      continue;
    }
    // Baris ini tidak muat lagi di potongan berjalan.
    if (kini) potongan.push(kini);
    kini = b;
  }
  if (kini) potongan.push(kini);

  const muat = potongan.slice(0, maks);
  const sisaBaris = potongan
    .slice(maks)
    .reduce((n, p) => n + p.split("\n").filter((x) => x.trim().length > 0).length, 0);

  /*
   * Penanda bagian ditambahkan SESUDAH pemotongan, bukan sebelum.
   *
   * Sebelum pemotongan kita belum tahu ada berapa bagian, dan menebaknya lalu
   * membetulkan belakangan adalah cara paling mudah membuat "(bagian 3/2)".
   */
  const total = muat.length;
  const bagian = muat.map((p, i) => (total > 1 ? `${p}\n_(bagian ${i + 1}/${total})_` : p));

  if (sisaBaris > 0 && bagian.length > 0) {
    bagian[bagian.length - 1] +=
      `\n\nℹ️ ${sisaBaris} baris lagi tidak saya kirim supaya grup tidak tenggelam. Buka MARLIN untuk daftar penuhnya.`;
  }

  return { bagian, sisaBaris };
}
