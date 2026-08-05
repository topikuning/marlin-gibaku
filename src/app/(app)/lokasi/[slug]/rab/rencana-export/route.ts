import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getRencanaMingguan } from "@/lib/plan/rencana-mingguan";
import { buildRencanaMingguanXlsx } from "@/lib/export/rencana-xlsx";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Unduh Formulir Rencana Kerja Mingguan sebagai .xlsx (exceljs, server-side). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });
  }

  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const n = Number.parseInt(request.nextUrl.searchParams.get("minggu") ?? "", 10);
  if (!Number.isInteger(n) || n < 1) {
    return NextResponse.json({ error: "Minggu tidak valid" }, { status: 400 });
  }

  const rencana = await getRencanaMingguan(location.id, n);
  if (!rencana) return NextResponse.json({ error: "Rencana tidak tersedia" }, { status: 404 });

  const buffer = await buildRencanaMingguanXlsx(rencana);
  await audit(user.id, "weekly_plan.export_xlsx", "location", location.id, { weekNumber: n });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rencana-mingguan-${slug}-minggu-${n}.xlsx"`,
    },
  });
}
