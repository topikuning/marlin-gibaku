import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { buildTemuanXlsx } from "@/lib/export/temuan-xlsx";
import { papanTemuan } from "@/lib/findings/queries";
import { jakartaDateKey } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Unduh REGISTER TEMUAN (.xlsx) — DECISIONS 426. Barisnya persis papan
 * /temuan (query + saringan yang sama), jadi angka berkas == angka layar.
 * Capability ditegakkan DI ROUTE (AUTH-05): report.export + finding.view.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  if (!can(user.role, "report.export") || !can(user.role, "finding.view")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor register temuan" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const { baris } = await papanTemuan(user, {
    status: sp.get("status") ?? undefined,
    severity: sp.get("tingkat") ?? undefined,
    kategori: sp.get("kategori") ?? undefined,
    lokasi: sp.get("lokasi") ?? undefined,
    cari: sp.get("cari") ?? undefined,
  });

  const buffer = await buildTemuanXlsx(baris, user.fullName);
  await audit(user.id, "finding.export_register", "finding", null, { jumlah: baris.length });

  const nama = `Register Temuan ${jakartaDateKey(new Date())}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nama}"`,
    },
  });
}
