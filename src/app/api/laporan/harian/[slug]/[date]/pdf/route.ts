import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { parseDateKey } from "@/lib/format";
import { renderHarianKkpPdf } from "@/lib/pdf/harian-kkp";
import { getRequestOrigin } from "@/lib/http";

/** Unduh Laporan Harian — blanko resmi KKP, sama dengan yang disetor ke Drive
 *  & halaman cetak (DECISIONS 162). Auth → akses lokasi. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; date: string }> }) {
  const { slug, date } = await ctx.params;
  if (!parseDateKey(date)) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 404 });

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

  // `?sampul=0` — cetak blanko tanpa sampul (DECISIONS 332). Sampulnya memang
  // sampul MINGGUAN ("MINGGU KE-n"); yang sudah mengambil berkas mingguan tidak
  // perlu sampul yang sama tercetak ulang di tiap harinya.
  const tanpaSampul = new URL(req.url).searchParams.get("sampul") === "0";
  const result = await renderHarianKkpPdf(slug, date, {
    baseUrl: await getRequestOrigin(),
    tanpaSampul,
  });
  if (!result) return NextResponse.json({ error: "Laporan harian tidak ditemukan" }, { status: 404 });

  /*
   * UNDUHAN DICATAT (DECISIONS 406) — bukan untuk mengawasi orang, melainkan
   * supaya tab Laporan bisa menjawab "berkas ini pernah diambil belum" tanpa
   * mengarang. Dicatat SESUDAH PDF-nya jadi: percobaan yang gagal bukan
   * pengambilan berkas.
   *
   * Ditulis di sini, bukan di tombolnya: tombol bisa dilewati (alamat ini bisa
   * dibuka langsung), dan yang dicatat harus kejadian yang sungguh terjadi di
   * server. `audit()` best-effort — gagal mencatat tidak boleh menggagalkan
   * unduhannya.
   */
  const report = await db.dailyReport.findUnique({
    where: {
      locationId_reportDate: { locationId: loc.id, reportDate: new Date(`${date}T00:00:00.000Z`) },
    },
    select: { id: true },
  });
  if (report) {
    await audit(user.id, "report.pdf_unduh", "daily_report", report.id, {
      locationId: loc.id,
      dateKey: date,
      tanpaSampul,
    });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="laporan-harian-${slug}-${date}.pdf"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
