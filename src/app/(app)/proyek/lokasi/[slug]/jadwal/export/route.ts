import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";
import { buildJadwalXlsx } from "@/lib/export/xlsx";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Unduh Time Schedule (Kurva-S) sebagai .xlsx dengan GRAFIK NATIVE Excel —
 * snapshot s/d minggu berjalan, periode = seluruh masa kontrak. Butuh SPMK.
 */
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

  // Jadwal tetap tersedia sebelum SPMK (asumsi mulai hari ini dari durasi kontrak).
  const bounds = await getPeriodBounds(location.id, { assume: true });
  if (!bounds) return NextResponse.json({ error: "Jadwal butuh kontrak + durasi" }, { status: 404 });
  const report = await getPeriodReport(location.id, "mingguan", bounds.currentWeek, { assume: true });
  if (!report) return NextResponse.json({ error: "Jadwal tidak tersedia" }, { status: 404 });

  const buffer = await buildJadwalXlsx(report);
  await audit(user.id, "report.export_jadwal_xlsx", "location", location.id, { week: bounds.currentWeek });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="time-schedule-${slug}.xlsx"`,
    },
  });
}
