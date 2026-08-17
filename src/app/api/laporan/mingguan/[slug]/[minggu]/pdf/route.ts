import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { renderMingguanKkpPdf } from "@/lib/pdf/mingguan-kkp";
import { getRequestOrigin } from "@/lib/http";

/**
 * Unduh BERKAS MINGGUAN — satu sampul + tujuh laporan harian (DECISIONS 332).
 *
 * Gerbangnya sama persis dengan unduhan harian: mengunduh PDF adalah EKSPOR
 * dokumen, jadi `report.export` ditegakkan DI ROUTE, bukan sekadar
 * menyembunyikan tombol — GET langsung tetap bisa dipanggil (audit AUTH-05).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string; minggu: string }> },
) {
  const { slug, minggu } = await ctx.params;
  const n = Number(minggu);
  if (!Number.isInteger(n) || n < 1) {
    return NextResponse.json({ error: "Nomor minggu tidak valid" }, { status: 404 });
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

  const hasil = await renderMingguanKkpPdf(slug, n, { baseUrl: await getRequestOrigin() });
  if (!hasil) {
    // Sebab paling sering: SPMK belum terbit, jadi "minggu ke-n" belum punya
    // tanggal. Disebutkan, bukan dijawab 404 telanjang.
    return NextResponse.json(
      { error: "Berkas mingguan belum bisa disusun — lokasi ini belum punya tanggal SPMK." },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(hasil.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="laporan-harian-minggu-${n}-${slug}.pdf"`,
      "Content-Length": String(hasil.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
