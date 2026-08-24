import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { jakartaDateKey } from "@/lib/format";
import { kesiapanPortofolio } from "@/lib/kesiapan/builder";
import { buildKesiapanPdf } from "@/lib/pdf/kesiapan";

export const dynamic = "force-dynamic";

/** Unduh LAPORAN KESIAPAN (.pdf) — hasil rule engine yang sama dengan /kesiapan. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  if (!can(user.role, "report.export") || !can(user.role, "package.view")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan kesiapan" }, { status: 403 });
  }

  const paket = await kesiapanPortofolio(user);
  const buffer = await buildKesiapanPdf(paket, user.fullName);
  await audit(user.id, "kesiapan.export_pdf", "package", null, { jumlahPaket: paket.length });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Laporan Kesiapan ${jakartaDateKey(new Date())}.pdf"`,
    },
  });
}
