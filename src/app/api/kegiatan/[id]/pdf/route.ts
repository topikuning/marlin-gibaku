import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { renderKegiatanPdf } from "@/lib/pdf/kegiatan";
import { getRequestOrigin } from "@/lib/http";

/**
 * Unduh Laporan Kegiatan Lapangan sebagai PDF (dihasilkan server-side, bukan
 * print browser). Auth → scope lokasi → render pdfkit → stream. DECISIONS 124.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID kegiatan tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });
  // Mengunduh PDF = EKSPOR dokumen, bukan sekadar melihat layar: capability
  // `report.export` ditegakkan di route, bukan hanya menyembunyikan tombol
  // (audit Codex 2026-07-28, AUTH-05 — direct GET tetap bisa dipanggil).
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan" }, { status: 403 });
  }

  const activity = await db.fieldActivity.findUnique({ where: { id }, select: { locationId: true } });
  if (!activity) return NextResponse.json({ error: "Kegiatan tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, activity.locationId))) {
    return NextResponse.json({ error: "Tidak punya akses ke kegiatan ini" }, { status: 403 });
  }

  const result = await renderKegiatanPdf(id, { baseUrl: await getRequestOrigin() });
  if (!result) return NextResponse.json({ error: "Kegiatan tidak ditemukan" }, { status: 404 });

  const fileName = `laporan-kegiatan-${result.slug}-${result.activityDate.toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
