import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Memulai putaran cadangan ke Google Drive di latar (DECISIONS 650): database
 * bila sudah waktunya (sekali sehari), lalu berkas sampai ±50 menit.
 *
 *   curl -X POST https://<host>/api/cron/cadangan -H "x-cron-secret: $CRON_SECRET"
 *
 * Dipanggil tiap jam oleh `.github/workflows/cron-cadangan.yml`. Memakai
 * `CRON_SECRET` yang sudah ada; tanpa secret dibalas 404 seperti jalur cron lain.
 */
function rahasiaCocok(diberikan: string | null): boolean {
  const benar = process.env.CRON_SECRET ?? "";
  if (!benar || !diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(benar);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!rahasiaCocok(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  try {
    const { mulaiCadanganLatar, keadaanCadanganLatar } = await import("@/lib/cadangan/jalankan");
    const mulai = await mulaiCadanganLatar();
    const { terakhir } = keadaanCadanganLatar();
    return NextResponse.json({ ...mulai, putaranTerakhir: terakhir });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Putaran cadangan gagal" }, { status: 500 });
  }
}
