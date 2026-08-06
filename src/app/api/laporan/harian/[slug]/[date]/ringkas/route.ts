import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { parseDateKey } from "@/lib/format";
import { renderHarianRingkasPdf } from "@/lib/pdf/harian-ringkas";

/**
 * Unduh Laporan Harian RINGKAS — dokumen bacaan untuk grup WhatsApp, bukan
 * blanko KKP (DECISIONS 261). Blanko resmi tetap di `../pdf`.
 *
 * Pagarnya sama dengan blanko: sesi → `report.export` ditegakkan DI ROUTE
 * (bukan sekadar menyembunyikan tombol; GET langsung tetap bisa dipanggil) →
 * akses lokasi.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; date: string }> }) {
  const { slug, date } = await ctx.params;
  if (!parseDateKey(date)) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 404 });

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

  const result = await renderHarianRingkasPdf(slug, date);
  // Tidak seperti blanko, ringkasan TETAP terbentuk walau laporan hariannya
  // belum ada — kegiatan lapangan hari itu bisa saja ada, dan "belum ada
  // laporan" adalah keterangan yang berguna. null di sini hanya berarti
  // lokasinya tidak ada.
  if (!result) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="laporan-harian-ringkas-${slug}-${date}.pdf"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
