import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";
import { buildRencanaRealisasiXlsx } from "@/lib/export/xlsx";
import { muatLogoLaporan } from "@/lib/export/logo-laporan";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Unduh LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI sebagai .xlsx
 * (DECISIONS 674) – posisi s/d minggu berjalan, seluruh masa kontrak.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  if (!can(user.role, "report.export")) return NextResponse.json({ error: "Anda tidak punya izin untuk ini." }, { status: 403 });

  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Anda tidak punya akses ke lokasi ini." }, { status: 403 });
  }

  const bounds = await getPeriodBounds(location.id, { assume: true });
  if (!bounds) {
    return NextResponse.json({ error: "Laporan belum bisa dibuat karena kontrak atau durasinya belum diisi." }, { status: 404 });
  }
  const report = await getPeriodReport(location.id, "mingguan", bounds.currentWeek, { assume: true });
  if (!report) return NextResponse.json({ error: "Laporan tidak tersedia" }, { status: 404 });

  const buffer = await buildRencanaRealisasiXlsx(report, { logo: await muatLogoLaporan(location.id) });
  await audit(user.id, "report.export_rencana_realisasi_xlsx", "location", location.id, { week: bounds.currentWeek });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rencana-realisasi-kategori-${slug}.xlsx"`,
    },
  });
}
