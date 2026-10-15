import { sajikanTokenBerkas } from "@/lib/penyimpanan/sajikan-berkas";

export const dynamic = "force-dynamic";

/**
 * Isi berkas yang sudah dipindah ke arsip Lenovo (DECISIONS 645).
 *
 * Pengganti alamat presign R2 untuk berkas yang tidak lagi di R2: MARLIN
 * mengambilnya dari Lenovo lalu menyerahkannya. PUBLIK seperti alamat presign
 * – yang menjaga adalah token HMAC berumur pendek yang hanya dibuat MARLIN
 * untuk orang yang sudah lolos pemeriksaan hak di halaman/route pemanggilnya.
 * Alamat yang membawa nama berkas: `[token]/[nama]` (DECISIONS 676).
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return sajikanTokenBerkas(req, token);
}
