import { sajikanTokenBerkas } from "@/lib/penyimpanan/sajikan-berkas";
import { bacaRuasNama } from "@/lib/penyimpanan/nama-unduhan";

export const dynamic = "force-dynamic";

/**
 * Sama dengan `/api/berkas/<token>`, dengan nama berkas di ruas terakhir
 * alamat – peramban dan penampil PDF-nya menamai simpanan dari situ, bukan
 * dari token (DECISIONS 676).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string; nama: string }> }) {
  const { token, nama } = await ctx.params;
  return sajikanTokenBerkas(req, token, bacaRuasNama(nama));
}
