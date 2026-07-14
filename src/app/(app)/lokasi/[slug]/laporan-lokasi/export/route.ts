import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { buildPeriodReportXlsx } from "@/lib/export/xlsx";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Export laporan periodik ke xlsx (server-side via exceljs — bukan AG Grid Enterprise). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "report.export")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const location = await db.location.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") === "bulanan" ? "bulanan" : "mingguan";
  const n = Number.parseInt(sp.get("n") ?? "1", 10);
  if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: "Periode tidak valid" }, { status: 400 });

  const report = await getPeriodReport(location.id, kind as PeriodKind, n);
  if (!report) return NextResponse.json({ error: "Laporan tidak tersedia" }, { status: 404 });

  const buffer = await buildPeriodReportXlsx(report);
  await audit(user.id, "report.export_xlsx", "location", location.id, { kind, n });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="laporan-${kind}-${slug}-${n}.xlsx"`,
    },
  });
}
