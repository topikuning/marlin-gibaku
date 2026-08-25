import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { renderPeriodikKkpPdf } from "@/lib/pdf/periodik-kkp";
import type { PeriodKind } from "@/lib/periodic-report";

/** Unduh Laporan Mingguan/Bulanan — blanko resmi KKP, sama dengan yang disetor
 *  ke Drive & halaman cetak (DECISIONS 162). Auth → akses lokasi. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; kind: string; n: string }> }) {
  const { slug, kind, n } = await ctx.params;
  if (kind !== "mingguan" && kind !== "bulanan") {
    return NextResponse.json({ error: "Jenis periode tidak valid" }, { status: 404 });
  }
  const nNum = Number(n);
  if (!Number.isInteger(nNum) || nNum < 1 || nNum > 520) {
    return NextResponse.json({ error: "Nomor periode tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  // Mengunduh PDF = EKSPOR dokumen, bukan sekadar melihat layar: capability
  // `report.export` ditegakkan di route, bukan hanya menyembunyikan tombol
  // (audit Codex 2026-07-28, AUTH-05 — direct GET tetap bisa dipanggil).
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan" }, { status: 403 });
  }

  const loc = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!loc) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  if (!(await hasLocationAccess(user, loc.id))) {
    return NextResponse.json({ error: "Tidak punya akses ke laporan ini" }, { status: 403 });
  }

  const result = await renderPeriodikKkpPdf(loc.id, kind as PeriodKind, nNum);
  if (!result) return NextResponse.json({ error: "Laporan untuk periode ini tidak tersedia" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="laporan-${kind}-${slug}-${nNum}.pdf"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
