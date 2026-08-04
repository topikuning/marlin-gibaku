import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getRecapLeaves } from "@/lib/daily-report/recap-import";

export const dynamic = "force-dynamic";

/**
 * Template Excel rekap laporan harian: daftar item RAB (kode · uraian · satuan ·
 * sisa volume) plus kolom kosong Tanggal & Volume Terpasang untuk diisi admin.
 * Header persis dikenali parser impor (Tanggal / Kode / Uraian / Volume).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  if (!can(user.role, "daily_report.create")) return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });

  const location = await db.location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const leaves = await getRecapLeaves(location.id);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rekap Harian");
  ws.columns = [
    { header: "Tanggal", key: "tanggal", width: 14 },
    { header: "Kode", key: "kode", width: 14 },
    { header: "Uraian Pekerjaan", key: "uraian", width: 48 },
    { header: "Satuan", key: "satuan", width: 10 },
    { header: "Sisa Volume", key: "sisa", width: 14 },
    { header: "Volume Terpasang", key: "volume", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };

  for (const l of leaves) {
    const sisa = l.volume != null ? Math.max(0, Math.round((l.volume - l.doneCumulative) * 1000) / 1000) : null;
    ws.addRow({ tanggal: "", kode: l.code, uraian: l.name, satuan: l.unit ?? "", sisa, volume: "" });
  }

  // Format kolom tanggal sebagai teks-tanggal supaya admin bisa isi bebas.
  ws.getColumn("tanggal").numFmt = "yyyy-mm-dd";

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template-rekap-harian-${slug}.xlsx"`,
    },
  });
}
