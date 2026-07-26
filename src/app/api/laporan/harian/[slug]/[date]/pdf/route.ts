import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { parseDateKey } from "@/lib/format";
import { renderHarianPdf } from "@/lib/pdf/harian";

/** Unduh Laporan Harian (PDF ringkas server-side). Auth → akses lokasi. DECISIONS 126. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; date: string }> }) {
  const { slug, date } = await ctx.params;
  if (!parseDateKey(date)) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });

  const loc = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!loc) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, loc.id))) {
    return NextResponse.json({ error: "Tidak punya akses ke laporan ini" }, { status: 403 });
  }

  const result = await renderHarianPdf(slug, date);
  if (!result) return NextResponse.json({ error: "Laporan harian tidak ditemukan" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="laporan-harian-${slug}-${date}.pdf"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
