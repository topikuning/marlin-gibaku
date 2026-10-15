import { periksaUnduhDokumen } from "@/lib/documents-unduh";
import { ambilBerkasDenganJenis } from "@/lib/penyimpanan/berkas";
import { galatAmbilBerkas, responsBerkas } from "@/lib/penyimpanan/sajikan-berkas";

export const dynamic = "force-dynamic";

/**
 * Isi dokumen, diserahkan MARLIN sendiri dengan nama aslinya (DECISIONS 676).
 *
 * Dulu dialihkan ke alamat sementara: presign R2 (2 menit) atau token arsip
 * Lenovo. Akibatnya nama simpanan = token, dan penampil PDF yang mengambil
 * ulang berkas saat tombol unduh ditekan gagal begitu alamatnya kedaluwarsa.
 * Alamat ini tetap berlaku selama sesi masuk masih ada. Ruas `nama` hanya
 * hiasan untuk peramban; nama di header selalu dari data dokumen.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; nama: string }> }) {
  const { id } = await ctx.params;
  const r = await periksaUnduhDokumen(id);
  if ("tolak" in r) return r.tolak;
  try {
    const { isi, jenis } = await ambilBerkasDenganJenis(r.doc.r2Key);
    return responsBerkas(isi, r.doc.mimeType || jenis, r.doc.nama, "private, max-age=300");
  } catch (err) {
    return galatAmbilBerkas(err);
  }
}
