import "server-only";
import { isR2Configured, r2Delete } from "@/lib/r2";
import { antreHapusLenovo } from "@/lib/penyimpanan/berkas";
import { hapusDingin, setelanDingin } from "./dingin";

/**
 * HAPUS BERKAS ASLI DARI KEDUA TEMPATNYA (DECISIONS 705).
 *
 * Berkas asli foto bisa ada di R2, di arsip Lenovo, atau di keduanya selama
 * masa tenggang. `hapusBerkas` hanya mengenal R2 + `berkas_pindah`, sedangkan
 * berkas asli dipindah `arsip-asli/` dengan kolomnya sendiri – jadi sampai ini
 * ada, setiap foto yang dihapus meninggalkan salinan Lenovo-nya, dan "hapus
 * arsip asli" mencatat "dihapus permanen" padahal byte-nya masih di Lenovo
 * (OPEN_ISSUES FOTO-02). SEMUA jalur yang membuang berkas asli lewat sini.
 */
export type FotoAsli = {
  originalKey: string | null;
  originalArchivedAt: Date | null;
  /** sidik jari berkas asli – gateway menuntutnya untuk DELETE */
  sha256: string;
};

/**
 * Salinan R2 dihapus lebih dulu dan kegagalannya DILEMPAR: pemanggil yang
 * menandai baris "dihapus" hanya sesudah berkasnya benar-benar hilang tetap
 * bisa berpegang pada itu. Salinan Lenovo yang belum bisa dihapus (arsip
 * mati, belum diatur) dititipkan dan diulang putaran berikutnya – mesin arsip
 * yang mati tidak boleh menahan orang membuang fotonya.
 *
 * @returns true bila salinan Lenovo masih menunggu dihapus.
 */
export async function hapusBerkasAsli(foto: FotoAsli): Promise<boolean> {
  if (!foto.originalKey) return false;
  if (isR2Configured()) await r2Delete(foto.originalKey);
  return hapusSalinanLenovoAsli(foto);
}

/** Hanya salinan Lenovo – untuk pemanggil yang sudah menghapus R2-nya borongan. */
export async function hapusSalinanLenovoAsli(foto: FotoAsli): Promise<boolean> {
  if (!foto.originalKey || !foto.originalArchivedAt) return false;
  const sha256 = foto.sha256.toLowerCase();
  const s = setelanDingin();
  try {
    if (!s) throw new Error("arsip belum dikonfigurasi");
    await hapusDingin(s, foto.originalKey, sha256);
    return false;
  } catch (err) {
    await antreHapusLenovo({
      kunci: foto.originalKey,
      kunciDingin: foto.originalKey,
      sha256,
      sebab: err instanceof Error ? err.message : "gagal",
    });
    return true;
  }
}
