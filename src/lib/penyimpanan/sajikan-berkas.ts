import "server-only";
import { NextResponse } from "next/server";
import { ambilBerkasDenganJenis, bacaTokenBerkas, BerkasTidakTerjangkau } from "./berkas";
import { kepalaDisposisi, namaUnduhan } from "./nama-unduhan";

/**
 * Isi sebuah berkas sebagai respons unduhan: jenis, ukuran, dan NAMA yang
 * benar (DECISIONS 676). Dipakai `/api/berkas/<token>[/<nama>]` dan
 * `/api/documents/<id>/<nama>`.
 */
export function responsBerkas(isi: Buffer, jenis: string | null, nama: string | null, cache: string): Response {
  const tipe = jenis || "application/octet-stream";
  const kepala: Record<string, string> = {
    "Content-Type": tipe,
    "Content-Length": String(isi.length),
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    // Tanpa nama pun jenis yang tidak aman tetap diunduh, tidak dibuka di tab.
    "Content-Disposition": nama ? kepalaDisposisi(nama, tipe) : kepalaDisposisi("berkas", tipe).split(";")[0],
  };
  return new NextResponse(new Uint8Array(isi), { status: 200, headers: kepala });
}

/** Berkas yang tidak ada di R2 (NoSuchKey) dibedakan dari R2 yang sedang bermasalah. */
export function galatAmbilBerkas(err: unknown): Response {
  if (err instanceof BerkasTidakTerjangkau) return NextResponse.json({ error: err.message }, { status: 503 });
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
    return NextResponse.json(
      { error: "Isi berkas ini tidak ditemukan di penyimpanan. Unggah ulang berkasnya." },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { error: "Penyimpanan berkas sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi." },
    { status: 503 },
  );
}

/** Isi berkas arsip Lenovo lewat token HMAC (DECISIONS 645). `nama` dari ruas alamat atau `?nama=` lama. */
export async function sajikanTokenBerkas(req: Request, token: string, namaRuas?: string): Promise<Response> {
  const kunci = bacaTokenBerkas(token);
  if (!kunci) return NextResponse.json({ error: "Link tidak berlaku atau sudah kedaluwarsa." }, { status: 404 });
  try {
    const { isi, jenis } = await ambilBerkasDenganJenis(kunci);
    // Nama di alamat tidak ditandatangani – dirapikan lagi seperti nama unggahan.
    const diminta = namaRuas || new URL(req.url).searchParams.get("nama");
    const nama = diminta ? namaUnduhan(diminta, jenis, "berkas") : null;
    // Isi sebuah kunci tidak pernah berubah; tokennya berlaku ±1 jam.
    return responsBerkas(isi, jenis, nama, "private, max-age=3600");
  } catch (err) {
    return galatAmbilBerkas(err);
  }
}
