import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { buildKurvaPaketXlsx } from "@/lib/export/xlsx";
import { muatLogoLaporan } from "@/lib/export/logo-laporan";
import { muatTtdPdf } from "@/lib/pdf/ttd-gambar";
import { periksaKurvaPaket } from "@/lib/laporan/kurva-paket-route";
import { kepalaDisposisi, namaUnduhan } from "@/lib/penyimpanan/nama-unduhan";

export const dynamic = "force-dynamic";

/** Kurva-S paket – gabungan seluruh lokasi – sebagai .xlsx dengan grafik native (DECISIONS 678). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await periksaKurvaPaket(id);
  if ("tolak" in r) return r.tolak;
  const buffer = await buildKurvaPaketXlsx(r.dok.report, {
    logo: await muatLogoLaporan(r.dok.lokasiAcuanId),
    catatan: r.dok.catatan,
    // Sama dengan PDF kurva paket: penanda tangan lokasi acuan, dokumen jadwal (DECISIONS 757).
    ttd: await muatTtdPdf(r.dok.lokasiAcuanId, "jadwal"),
  });
  await audit(r.userId, "report.export_kurva_paket_xlsx", "package", id);
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": kepalaDisposisi(namaUnduhan(`Kurva S Paket – ${r.dok.paket.name}`, mime), mime),
      "Cache-Control": "private, no-store",
    },
  });
}
