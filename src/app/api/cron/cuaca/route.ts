import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Pembaruan cuaca laporan kemarin dari pengamatan satelit, pukul 04.00 WIB
 * (DECISIONS 657, 659) – termasuk laporan yang sudah final.
 *
 *   curl -X POST https://<host>/api/cron/cuaca -H "x-cron-secret: $CRON_SECRET"
 *
 * Hanya MEMULAI putaran di latar lalu pulang; putarannya sendiri memeriksa
 * sakelar dan jam, dan laporan yang isinya sudah sama tidak ditulis ulang, jadi
 * aman dipicu berkali-kali.
 * Bila pemanggilan ini terlewat, putaran per jam `/api/cron/arsip-asli`
 * menyusulnya. Tanpa secret dibalas 404, sama seperti jalur cron lain.
 */
function rahasiaCocok(diberikan: string | null): boolean {
  const benar = process.env.CRON_SECRET ?? "";
  if (!benar || !diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(benar);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!rahasiaCocok(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  const { mulaiPerbaruiCuacaSubuh } = await import("@/lib/weather/subuh");
  return NextResponse.json(mulaiPerbaruiCuacaSubuh());
}
