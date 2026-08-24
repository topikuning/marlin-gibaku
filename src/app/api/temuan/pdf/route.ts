import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { papanTemuan } from "@/lib/findings/queries";
import { jakartaDateKey } from "@/lib/format";
import { buildTemuanRegisterPdf } from "@/lib/pdf/temuan-register";

export const dynamic = "force-dynamic";

/** Unduh REGISTER TEMUAN (.pdf) — baris & saringan sama persis dengan layar/.xlsx. */
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

  const buffer = await buildTemuanRegisterPdf(baris, user.fullName);
  await audit(user.id, "finding.export_register_pdf", "finding", null, { jumlah: baris.length });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Register Temuan ${jakartaDateKey(new Date())}.pdf"`,
    },
  });
}
