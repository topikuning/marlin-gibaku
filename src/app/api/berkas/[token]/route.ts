import { NextResponse } from "next/server";
import { ambilBerkasDenganJenis, bacaTokenBerkas, BerkasTidakTerjangkau } from "@/lib/penyimpanan/berkas";

export const dynamic = "force-dynamic";

/**
 * Isi berkas yang sudah dipindah ke arsip Lenovo (DECISIONS 645).
 *
 * Pengganti alamat presign R2 untuk berkas yang tidak lagi di R2: MARLIN
 * mengambilnya dari Lenovo lalu menyerahkannya. PUBLIK seperti alamat presign
 * – yang menjaga adalah token HMAC berumur pendek yang hanya dibuat MARLIN
 * untuk orang yang sudah lolos pemeriksaan hak di halaman/route pemanggilnya.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const kunci = bacaTokenBerkas(token);
  if (!kunci) return NextResponse.json({ error: "Link tidak valid atau kedaluwarsa." }, { status: 404 });
  try {
    const { isi, jenis } = await ambilBerkasDenganJenis(kunci);
    const nama = new URL(req.url).searchParams.get("nama");
    const kepala: Record<string, string> = {
      "Content-Type": jenis ?? "application/octet-stream",
      "Content-Length": String(isi.length),
      // Isi sebuah kunci tidak pernah berubah; tokennya berlaku ±1 jam.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    if (nama) kepala["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(nama)}`;
    return new NextResponse(new Uint8Array(isi), { status: 200, headers: kepala });
  } catch (err) {
    if (err instanceof BerkasTidakTerjangkau) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
  }
}
