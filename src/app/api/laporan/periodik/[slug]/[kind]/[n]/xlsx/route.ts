import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";

/**
 * Unduh laporan periodik sebagai EXCEL (DECISIONS 334).
 *
 * Sebelumnya Excel laporan periodik hanya bisa keluar lewat kirim-WhatsApp atau
 * unggah-Drive — tidak ada cara mengunduhnya. Ketahuan saat merapikan tombol
 * jadi satu menu per berkas: begitu tiap berkas ditanya "mau diapakan?",
 * lubangnya langsung terlihat. Berkasnya sendiri sudah lama dibangun
 * `buildPeriodReportXlsx`; yang belum ada cuma pintunya.
 *
 * Gerbangnya sama persis dengan unduhan PDF: `report.export` ditegakkan DI
 * ROUTE, bukan sekadar menyembunyikan tombol (audit AUTH-05).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string; kind: string; n: string }> },
) {
  const { slug, kind, n } = await ctx.params;
  if (kind !== "mingguan" && kind !== "bulanan") {
    return NextResponse.json({ error: "Jenis periode tidak valid" }, { status: 404 });
  }
  const periodN = Number(n);
  if (!Number.isInteger(periodN) || periodN < 1) {
    return NextResponse.json({ error: "Nomor periode tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan" }, { status: 403 });
  }

  const loc = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!loc) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, loc.id))) {
    return NextResponse.json({ error: "Tidak punya akses ke laporan ini" }, { status: 403 });
  }

  const report = await getPeriodReport(loc.id, kind as PeriodKind, periodN);
  if (!report) return NextResponse.json({ error: "Laporan periodik tidak ditemukan" }, { status: 404 });

  const [{ buildPeriodReportXlsx }, { muatLogoLaporan }] = await Promise.all([
    import("@/lib/export/xlsx"),
    import("@/lib/export/logo-laporan"),
  ]);
  const buf = await buildPeriodReportXlsx(report, { logo: await muatLogoLaporan(loc.id) });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="laporan-${kind}-${periodN}-${slug}.xlsx"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
