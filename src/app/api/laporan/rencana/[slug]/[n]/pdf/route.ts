import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { renderRencanaKkpPdf } from "@/lib/pdf/rencana-kkp";

/**
 * Unduh Formulir Rencana Kerja Mingguan sebagai PDF – berkas yang SAMA dengan
 * yang dikirim ke WA (DECISIONS 258), plus tanda tangan & stempel lokasi.
 *
 * Ada karena aplikasi terpasang (PWA) sering tidak bisa memunculkan dialog
 * cetak dari halaman `/cetak/rencana` (laporan user 2026-10-11). Dari sini
 * penampil PDF HP/komputer yang mencetak.
 *
 * Gerbangnya sama dengan unduhan harian: mengunduh PDF = EKSPOR dokumen, jadi
 * `report.export` ditegakkan DI ROUTE (audit AUTH-05), lalu akses lokasi.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; n: string }> }) {
  const { slug, n } = await ctx.params;
  const minggu = Number(n);
  if (!Number.isInteger(minggu) || minggu < 1 || minggu > 520) {
    return NextResponse.json({ error: "Nomor minggu tidak valid" }, { status: 404 });
  }

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

  const hasil = await renderRencanaKkpPdf(loc.id, minggu);
  if (!hasil) {
    return NextResponse.json({ error: "Rencana untuk minggu ini tidak tersedia" }, { status: 404 });
  }

  // Dicatat SESUDAH PDF-nya jadi: percobaan yang gagal bukan pengambilan
  // berkas. Best-effort – gagal mencatat tidak menggagalkan unduhan.
  await audit(user.id, "weekly_plan.export_pdf", "location", loc.id, { weekNumber: minggu });

  return new NextResponse(new Uint8Array(hasil.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rencana-mingguan-${slug}-minggu-${minggu}.pdf"`,
      "Content-Length": String(hasil.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
