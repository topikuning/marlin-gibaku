import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { renderRencanaRealisasiPdf } from "@/lib/pdf/periodik-kkp";

/**
 * Unduh LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI sebagai PDF – cermin
 * halaman `/cetak/rencana-realisasi` (DECISIONS 674). Gerbangnya sama dengan
 * PDF Time Schedule: `report.export`, lalu akses lokasi.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan" }, { status: 403 });
  }

  const loc = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!loc) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, loc.id))) {
    return NextResponse.json({ error: "Tidak punya akses ke laporan ini" }, { status: 403 });
  }

  const hasil = await renderRencanaRealisasiPdf(loc.id);
  if (!hasil) {
    return NextResponse.json(
      { error: "Laporan belum bisa dibuat karena kontrak atau durasinya belum diisi." },
      { status: 404 },
    );
  }

  await audit(user.id, "report.export_rencana_realisasi_pdf", "location", loc.id);

  return new NextResponse(new Uint8Array(hasil.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rencana-realisasi-kategori-${slug}.pdf"`,
      "Content-Length": String(hasil.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
