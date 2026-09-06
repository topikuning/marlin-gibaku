import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { jalurBasemap, periksaBasemap } from "@/lib/peta/berkas";

export const dynamic = "force-dynamic";

/**
 * PENYAJI PETA DASAR (.pmtiles) DARI VOLUME.
 *
 * Format PMTiles dirancang untuk dibaca SEPOTONG-SEPOTONG: peramban meminta
 * rentang byte (`Range`) sesuai ubin yang sedang terlihat, bukan mengunduh
 * berkas ratusan MB itu utuh. Karena itu jalur ini WAJIB menjawab `Range` dan
 * mengumumkan `Accept-Ranges`; tanpa itu MapLibre akan menarik seluruh berkas
 * pada peta pertama yang dibuka — dan di HP lapangan, itu bencana kuota.
 *
 * Berada di belakang sesi seperti seluruh `(app)`: peta dasar memang data
 * publik (OpenStreetMap), tapi bandwidth-nya milik proyek ini, dan tidak ada
 * alasan membiarkannya diambil siapa pun yang menemukan alamatnya.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });

  const berkas = await periksaBasemap();
  if (!berkas.ada) {
    return NextResponse.json(
      {
        error:
          "Peta dasar belum ada di server ini. Buka /sistem – kartu Kesehatan Layanan menyebut keadaannya dan tombol untuk mengunduhnya.",
      },
      { status: 404 },
    );
  }

  const total = berkas.ukuran;
  const umum = {
    "Content-Type": "application/octet-stream",
    "Accept-Ranges": "bytes",
    // Berkasnya diganti hanya saat sengaja diperbarui; peramban boleh
    // menyimpannya lama. `private` karena jalurnya ber-sesi.
    "Cache-Control": "private, max-age=86400",
  };

  const range = req.headers.get("range");
  if (!range) {
    const s = createReadStream(jalurBasemap);
    return new NextResponse(Readable.toWeb(s) as ReadableStream, {
      headers: { ...umum, "Content-Length": String(total) },
    });
  }

  const cocok = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!cocok) {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  }
  const [, awalStr, akhirStr] = cocok;
  let awal = awalStr ? Number(awalStr) : 0;
  let akhir = akhirStr ? Number(akhirStr) : total - 1;
  // `bytes=-500` berarti 500 byte TERAKHIR — dipakai pmtiles untuk membaca
  // ekor arsip; salah menanganinya membuat peta gagal tanpa pesan.
  if (!awalStr && akhirStr) {
    awal = Math.max(0, total - Number(akhirStr));
    akhir = total - 1;
  }
  if (Number.isNaN(awal) || Number.isNaN(akhir) || awal > akhir || awal >= total) {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  }
  akhir = Math.min(akhir, total - 1);

  const s = createReadStream(jalurBasemap, { start: awal, end: akhir });
  return new NextResponse(Readable.toWeb(s) as ReadableStream, {
    status: 206,
    headers: {
      ...umum,
      "Content-Range": `bytes ${awal}-${akhir}/${total}`,
      "Content-Length": String(akhir - awal + 1),
    },
  });
}
