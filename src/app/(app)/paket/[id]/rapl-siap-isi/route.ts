import { NextResponse } from "next/server";
import { z } from "zod";
import { accessibleLocationIds, getCurrentUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { muatRaplSiapIsi } from "@/lib/rapl-siap-isi/data";
import { buildRaplSiapIsiXlsx } from "@/lib/export/rapl-siap-isi-xlsx";
import { kepalaDisposisi, namaUnduhan } from "@/lib/penyimpanan/nama-unduhan";

export const dynamic = "force-dynamic";

/**
 * Unduh "RAPL siap isi harga" SATU PAKET – semua lokasinya dalam satu berkas,
 * satu sheet Isi Harga bersama (DECISIONS 803), seperti contoh keluaran
 * referensi user (6 lokasi Bolaang Mongondow Timur). Hanya lokasi yang boleh
 * dibuka pemakainya dan yang punya RAB aktif.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tolak = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (!z.uuid().safeParse(id).success) return tolak("Paket tidak ditemukan", 404);
  const user = await getCurrentUser();
  if (!user) return tolak("Anda belum masuk. Silakan masuk dulu.", 401);
  if (user.mustChangePassword) return tolak("Ganti password terlebih dahulu.", 403);
  if (!can(user.role, "report.export") || !can(user.role, "rapl.view") || !can(user.role, "package.view")) {
    return tolak("Tidak punya izin", 403);
  }
  const paket = await db.package.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, name: true } });
  if (!paket) return tolak("Paket tidak ditemukan", 404);
  const locIds = await accessibleLocationIds(user);
  const lokasi = await db.location.findMany({
    where: {
      ...locationScopeWhere(user, locIds),
      packageId: paket.id,
      rabRevisions: { some: { status: "aktif" } },
    },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (lokasi.length === 0) return tolak("Belum ada lokasi paket ini yang punya RAB aktif dan boleh Anda buka.", 404);

  const data = await muatRaplSiapIsi(lokasi.map((l) => l.id));
  const buffer = await buildRaplSiapIsiXlsx({ judul: `Paket ${paket.name} – ${data.length} lokasi`, lokasi: data });
  await audit(user.id, "report.export_rapl_siap_isi", "package", paket.id, { lokasi: data.length });
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": kepalaDisposisi(namaUnduhan(`RAPL siap isi – ${paket.name}`, mime), mime),
      "Cache-Control": "private, no-store",
    },
  });
}
