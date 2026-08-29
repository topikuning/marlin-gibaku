import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { jalankanTugasHarian } from "@/lib/harian/penjadwal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pekerjaan harian MARLIN (DECISIONS 202) — dipicu penjadwal LUAR (Railway
 * Cron / cron server) sekali sehari, disarankan 18:00 WIB = 11:00 UTC — jam
 * yang dipakai `cron-harian.yml` dan yang ditetapkan user untuk pengingat ke
 * grup paket.
 *
 *   curl -X POST https://<host>/api/cron/harian -H "x-cron-secret: $CRON_SECRET"
 *
 * Otentikasi lewat `CRON_SECRET`, BUKAN sesi: penjadwal tidak punya cookie.
 * Route ini PUBLIK di middleware, jadi rahasianya adalah satu-satunya pagar —
 * karena itu perbandingannya timing-safe dan tanpa secret = 404 (bukan 401),
 * supaya keberadaan endpoint-nya tidak bisa dipetakan dari luar.
 *
 * Aman dipicu berkali-kali: aktivasi SPMK memeriksa ulang status di dalam
 * transaksi, dan pengingat WA dijaga UNIQUE (user, tanggal).
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
  try {
    const hasil = await jalankanTugasHarian();
    return NextResponse.json({ ok: true, ...hasil });
  } catch (err) {
    console.error("[cron/harian] gagal:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal" },
      { status: 500 },
    );
  }
}
