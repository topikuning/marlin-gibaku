import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { periksaKurvaPaket } from "@/lib/laporan/kurva-paket-route";
import { renderKurvaPaketPdf } from "@/lib/pdf/periodik-kkp";
import { kepalaDisposisi, namaUnduhan } from "@/lib/penyimpanan/nama-unduhan";

export const dynamic = "force-dynamic";

/** Kurva-S paket – gabungan seluruh lokasi – sebagai PDF (DECISIONS 678). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await periksaKurvaPaket(id);
  if ("tolak" in r) return r.tolak;
  const { buffer } = await renderKurvaPaketPdf(r.dok);
  await audit(r.userId, "report.export_kurva_paket_pdf", "package", id);
  const mime = "application/pdf";
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": kepalaDisposisi(namaUnduhan(`Kurva S Paket – ${r.dok.paket.name}`, mime), mime),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
