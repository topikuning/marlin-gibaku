import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { temaDeck } from "@/lib/paparan/tema";
import { namaBerkasLaporanLokasi } from "@/lib/lokasi-lengkap/jenis";

export const dynamic = "force-dynamic";

/**
 * UNDUH LAPORAN LENGKAP SATU LOKASI — A4 (`?bentuk=laporan`, bawaan) atau deck
 * 16:9 (`?bentuk=deck&tema=…`).
 *
 * Sesi WAJIB, dan `report.export` ditegakkan DI SINI — bukan hanya dengan
 * menyembunyikan tombolnya: GET langsung tetap bisa dipanggil siapa pun yang
 * tahu alamatnya (audit AUTH-05). Lokasi di luar akses dijawab 404 yang sama
 * dengan lokasi yang tidak ada, supaya keberadaannya pun tidak bocor.
 *
 * Cabang deck masih dibangun (tahap 2): `renderLaporanLokasiDeck` melempar
 * `DeckBelumTersediaError`, dan itu dijawab 503 dengan pesannya — bukan PDF
 * kosong yang mengaku deck.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  if (!can(user.role, "report.export")) {
    return NextResponse.json({ error: "Tidak punya izin mengekspor laporan" }, { status: 403 });
  }

  const lokasi = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!lokasi || !(await hasLocationAccess(user, lokasi.id))) {
    return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  }

  const sp = request.nextUrl.searchParams;
  const bentuk = sp.get("bentuk") === "deck" ? "deck" : "laporan";

  const { buatLaporanLokasiLengkap } = await import("@/lib/lokasi-lengkap/snapshot");
  const laporan = await buatLaporanLokasiLengkap(lokasi.id);
  if (!laporan) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });

  let buffer: Buffer;
  if (bentuk === "deck") {
    const { DeckBelumTersediaError, renderLaporanLokasiDeck } = await import("@/lib/lokasi-lengkap/render-deck");
    try {
      buffer = await renderLaporanLokasiDeck(laporan, { tema: temaDeck(sp.get("tema")).key });
    } catch (err) {
      if (err instanceof DeckBelumTersediaError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Gagal merender deck" },
        { status: 500 },
      );
    }
  } else {
    const { renderLaporanLokasiPdf } = await import("@/lib/lokasi-lengkap/render-pdf");
    try {
      buffer = await renderLaporanLokasiPdf(laporan);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Gagal merender PDF" },
        { status: 500 },
      );
    }
  }

  const namaBerkas = namaBerkasLaporanLokasi(laporan, bentuk);
  await audit(user.id, "report.lokasi_lengkap_unduh", "location", lokasi.id, {
    bentuk,
    asOfKey: laporan.asOfKey,
    berkas: namaBerkas,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${namaBerkas}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
