/**
 * BERKAS DRIVE MILIK MARLIN (DECISIONS 723) – murni.
 *
 * Ketetapan user 2026-10-31: *"intinya kamu jangan ubah atau hapus apa pun
 * buatan orang lain, kamu hanya boleh ubah apa yang kamu upload sendiri."*
 *
 * Sampai keputusan ini, unggahan MARLIN memperbarui berkas APA PUN yang
 * namanya sama di folder tujuan (DECISIONS 146) – termasuk berkas yang ditaruh
 * orang – dan sekalian menempelkan penanda "terbitan MARLIN" padanya. Jadi
 * penanda saja bukan bukti kepemilikan untuk berkas yang tersentuh kode lama.
 *
 * Berkas dianggap milik MARLIN – boleh ditimpa revisi atau dibuang ke Sampah –
 * hanya bila KETIGANYA benar:
 *  1. bertanda terbitan MARLIN;
 *  2. DIBUAT saat unggahan pertamanya tercatat di MARLIN (berkas yang sudah
 *     ada sebelum MARLIN pertama kali mengunggah ke sana bukan buatannya);
 *  3. TIDAK diubah orang lain sesudahnya (pengubah terakhirnya akun MARLIN).
 * Yang tidak lolos tidak disentuh: MARLIN membuat berkas baru di sebelahnya.
 */

export type MetaBerkasDrive = {
  id: string;
  createdTime: Date;
  /** appProperties `marlinTerbitan = 1`. */
  terbitanMarlin: boolean;
  /** Pengubah terakhirnya bukan akun Google MARLIN. */
  diubahOrangLain: boolean;
};

/**
 * Selisih paling lama antara berkas dibuat di Drive dan jejak unggahnya ditulis
 * MARLIN (jejak ditulis SESUDAH unggahan selesai; unggahan besar bisa lambat).
 */
export const TOLERANSI_DIBUAT_MS = 10 * 60_000;

/** `unggahPertama` = jejak unggah MARLIN paling awal untuk berkas ini; kosong = tidak pernah tercatat. */
export function milikMarlin(b: MetaBerkasDrive, unggahPertama: Date | null | undefined): boolean {
  if (!b.terbitanMarlin || b.diubahOrangLain || !unggahPertama) return false;
  return b.createdTime.getTime() >= unggahPertama.getTime() - TOLERANSI_DIBUAT_MS;
}
