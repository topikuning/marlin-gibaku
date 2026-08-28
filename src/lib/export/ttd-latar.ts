/**
 * LATAR PUTIH tanda tangan & stempel dijadikan tembus pandang sebelum ditempel
 * ke PDF.
 *
 * ### Kenapa perlu
 *
 * `lib/pdf/ttd-gambar.ts` sudah mencatat separuh masalahnya (DECISIONS 412):
 * PDF tidak punya z-index, jadi urutan menggambar itulah lapisannya, dan
 * stempel yang digambar belakangan MENGHAPUS teks di bawahnya. Obatnya waktu
 * itu membalik urutan — gambar dulu, teks sesudahnya.
 *
 * Itu belum cukup, dan berkas 26 Agustus 2026 membuktikannya: stempel pelaksana
 * tetap menutupi baris "( Ahmad Mu'min )". Membalik urutan hanya memindahkan
 * siapa yang menang di piksel yang sama; ia tidak membuat latar stempelnya
 * tembus pandang. Pindaian stempel selalu membawa kertas putih di sekelilingnya,
 * dan kertas putih itu kotak legap seluas gambarnya.
 *
 * Penyaji HTML tidak pernah kena karena memakai `mix-blend-multiply`
 * (`components/knmp/blok-ttd.tsx`) — putih jadi transparan di sana. pdfkit tidak
 * punya blend mode sama sekali, jadi kertas harus diberi obat yang berbeda:
 * putihnya DIBUANG dari gambarnya sendiri, sebelum masuk PDF.
 *
 * Catatan penting soal ukuran: ini BUKAN pengganti aturan ukuran di
 * `ttd-ukuran.ts`. Stempel memang BOLEH melimpah menimpa nama perusahaan dan
 * nama penanda tangan — begitulah dokumen aslinya (DECISIONS 330). Yang tidak
 * boleh adalah menghapusnya.
 *
 * Modul ini MURNI: ia mengubah larik piksel RGBA di tempat, tanpa sharp, tanpa
 * I/O — supaya bisa diuji langsung tanpa menyiapkan gambar sungguhan.
 */

/** Di atas kecerahan ini, piksel dianggap kertas: dibuang sepenuhnya. */
export const AMBANG_PUTIH = 240;
/**
 * Di bawah ini piksel dianggap tinta dan tidak disentuh. Antara keduanya
 * alfanya melandai supaya tepi gambar yang di-antialias tidak jadi bergerigi.
 */
export const AMBANG_TINTA = 205;

/**
 * Buang latar putih dari larik piksel RGBA, DI TEMPAT.
 *
 * Alfa yang sudah ada DIKALIKAN, bukan ditimpa: gambar yang memang sudah punya
 * bagian transparan tetap transparan, dan yang legap ikut aturan di atas.
 *
 * @returns berapa piksel yang alfanya berubah — dipakai uji untuk membuktikan
 *   ada yang benar-benar dikerjakan, bukan sekadar tidak melempar.
 */
export function hapusLatarPutih(piksel: Uint8Array | Uint8ClampedArray): number {
  let diubah = 0;
  for (let i = 0; i + 3 < piksel.length; i += 4) {
    const lama = piksel[i + 3];
    if (lama === 0) continue;
    // Kecerahan terasa (Rec. 601) — bukan rata-rata, supaya tinta biru tua
    // tidak salah dikira kertas.
    const terang = (piksel[i] * 299 + piksel[i + 1] * 587 + piksel[i + 2] * 114) / 1000;
    if (terang >= AMBANG_PUTIH) {
      piksel[i + 3] = 0;
      diubah++;
    } else if (terang > AMBANG_TINTA) {
      const sisa = (AMBANG_PUTIH - terang) / (AMBANG_PUTIH - AMBANG_TINTA);
      const baru = Math.round(lama * sisa);
      if (baru !== lama) {
        piksel[i + 3] = baru;
        diubah++;
      }
    }
  }
  return diubah;
}
