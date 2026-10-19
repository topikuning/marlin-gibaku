import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sinkron KAWAL KNMP (DECISIONS 690) – dipicu penjadwal luar sekali sehari.
 *
 *   curl -X POST https://<host>/api/cron/kawal -H "x-cron-secret: $CRON_SECRET"
 *
 * Satu putaran = masuk ke Kawal, ambil data lokasi SEKALI, simpan snapshot bila
 * isinya berubah. Aman dipicu berkali-kali: isi yang sama tidak membuat
 * snapshot baru, dan putaran yang tumpang tindih ditolak. Tanpa akun Kawal =
 * tidak melakukan apa-apa. Tanpa secret dibalas 404, sama seperti jalur cron lain.
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
  const { sinkronKawal } = await import("@/lib/kawal/sinkron");
  const hasil = await sinkronKawal({ pemicu: "cron" });
  // Gagal sinkron dijawab 200 dengan ok:false: penyebabnya (akun, bentuk data
  // Kawal berubah) bukan sesuatu yang diperbaiki dengan mengulang pemanggilan,
  // dan sudah tercatat di kawal_sync_runs + layar Kawal KNMP.
  return NextResponse.json({ ok: hasil.status !== "gagal", ...hasil });
}
