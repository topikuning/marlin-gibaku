import { NextResponse } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { muatRaplSiapIsi } from "@/lib/rapl-siap-isi/data";
import { buildRaplSiapIsiXlsx } from "@/lib/export/rapl-siap-isi-xlsx";

export const dynamic = "force-dynamic";

/**
 * Unduh "RAPL siap isi harga" satu lokasi – sekali klik (DECISIONS 803).
 * Izin sama dengan unduhan RAPL lain: `report.export` + `rapl.view` (memuat
 * biaya dan selisih terhadap RAB).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  if (!can(user.role, "report.export") || !can(user.role, "rapl.view")) {
    return NextResponse.json({ error: "Tidak punya izin" }, { status: 403 });
  }
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, location.id))) {
    return NextResponse.json({ error: "Tidak punya akses lokasi" }, { status: 403 });
  }

  const lokasi = await muatRaplSiapIsi([location.id]);
  const buffer = await buildRaplSiapIsiXlsx({ judul: `Lokasi ${location.name}`, lokasi });
  await audit(user.id, "report.export_rapl_siap_isi", "location", location.id, {
    item: lokasi[0]?.kategori.reduce((s, k) => s + k.item.length, 0) ?? 0,
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapl-siap-isi-${slug}.xlsx"`,
    },
  });
}
