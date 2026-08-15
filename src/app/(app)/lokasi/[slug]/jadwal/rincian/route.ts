import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";
import { muatRincianJadwal } from "@/lib/rincian-jadwal-data";
import { buildRincianJadwalXlsx } from "@/lib/export/rincian-jadwal-xlsx";
import { muatLogoLaporan } from "@/lib/export/logo-laporan";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Unduh RINCIAN Time Schedule sampai level ITEM sebagai .xlsx berkop resmi
 * (DECISIONS 316) — pendamping `/jadwal/export` yang hanya sampai kategori.
 *
 * Sama seperti ekspor jadwal: tetap tersedia SEBELUM SPMK (`assume: true`),
 * karena bobot & urutan pekerjaan sudah berarti sejak kontrak ada — tidak perlu
 * menunggu tanggal mulai terbit.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "report.export")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const bounds = await getPeriodBounds(location.id, { assume: true });
  if (!bounds) return NextResponse.json({ error: "Jadwal butuh kontrak + durasi" }, { status: 404 });
  const report = await getPeriodReport(location.id, "mingguan", bounds.currentWeek, { assume: true });
  if (!report) return NextResponse.json({ error: "Jadwal tidak tersedia" }, { status: 404 });

  const rincian = await muatRincianJadwal(location.id);
  if (!rincian) return NextResponse.json({ error: "RAB aktif belum ada" }, { status: 404 });

  const buffer = await buildRincianJadwalXlsx(rincian.rows, report.header, {
    logo: await muatLogoLaporan(location.id),
    totalWeeks: rincian.totalWeeks,
    origin: rincian.origin,
  });
  await audit(user.id, "report.export_rincian_jadwal_xlsx", "location", location.id, {
    baris: rincian.rows.length,
    origin: rincian.origin,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rincian-time-schedule-${slug}.xlsx"`,
    },
  });
}
