import { NextResponse } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { kepalaDisposisi, namaUnduhan } from "@/lib/penyimpanan/nama-unduhan";

export const dynamic = "force-dynamic";

/**
 * Lampiran dokumentasi 0% – 50% – 100% per sarana & prasarana (DECISIONS 683).
 * Gerbangnya sama dengan unduhan laporan lokasi lain: masuk, bukan password
 * sementara, `report.export`, dan lokasi dalam jangkauan (di luar jangkauan
 * dijawab 404 yang sama dengan lokasi yang tidak ada).
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
  const lokasi = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!lokasi || !(await hasLocationAccess(user, lokasi.id))) {
    return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  }

  const { renderDokumentasiSarprasPdf } = await import("@/lib/pdf/dokumentasi-sarpras");
  const hasil = await renderDokumentasiSarprasPdf(lokasi.id);
  if (!hasil) {
    return NextResponse.json(
      { error: "Belum ada RAB aktif. Sarana dan prasarana diambil dari kategori RAB aktif." },
      { status: 404 },
    );
  }
  await audit(user.id, "report.export_foto_sarpras_pdf", "location", lokasi.id);
  const mime = "application/pdf";
  return new NextResponse(new Uint8Array(hasil.buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": kepalaDisposisi(namaUnduhan(`Dokumentasi Sarpras 0-50-100 – ${hasil.lokasi}`, mime), mime),
      "Content-Length": String(hasil.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
