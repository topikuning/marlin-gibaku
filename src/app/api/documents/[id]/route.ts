import { alamatUnduhDokumen, periksaUnduhDokumen } from "@/lib/documents-unduh";
import { alihkanKeBerkas } from "@/lib/penyimpanan/alihkan";

/**
 * Link lama "buka berkas" di semua halaman. Hak akses diperiksa, lalu
 * dialihkan ke `/api/documents/<id>/<nama asli>` – alamat yang membawa nama
 * berkas, supaya yang tersimpan di perangkat bernama seperti saat diunggah,
 * bukan token atau kunci penyimpanan (DECISIONS 676). Dialihkan RELATIF;
 * jangan disusun terhadap req.url (alamat dalam server di Railway).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await periksaUnduhDokumen(id);
  if ("tolak" in r) return r.tolak;
  return alihkanKeBerkas(alamatUnduhDokumen(r.doc));
}
