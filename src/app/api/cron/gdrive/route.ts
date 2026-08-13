import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { jalankanAntreanDrive } from "@/lib/gdrive/antrean";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Satu putaran ANTREAN UNGGAH DRIVE (DECISIONS 313) — dipicu penjadwal luar.
 *
 *   curl -X POST https://<host>/api/cron/gdrive -H "x-cron-secret: $CRON_SECRET"
 *
 * Terpisah dari `/api/cron/harian` yang berjalan sekali sehari, karena keduanya
 * menjawab kebutuhan yang berbeda. Pekerjaan harian memang cukup sehari sekali;
 * antrean Drive sengaja MENAHAN diri tiap putaran (jeda antar berkas + batas
 * jatah) supaya tidak diblok Google, sehingga tunggakan besar butuh putaran
 * yang LEBIH SERING, bukan putaran yang lebih rakus. Jadwal yang disarankan:
 * tiap jam. Tanpa jadwal ini pun antrean tetap jalan — hanya sekali sehari,
 * menumpang putaran harian.
 *
 * Aman dipicu berkali-kali dan bersamaan: pekerjaan diambil secara atomik
 * (`status: menunggu` → `jalan`), dan putaran yang bertabrakan di satu proses
 * langsung mundur alih-alih menggandakan beban ke Drive.
 *
 * Otentikasi lewat `CRON_SECRET` (bukan sesi — penjadwal tidak punya cookie).
 * Tanpa secret = 404, bukan 401, supaya keberadaan endpoint tidak terpetakan.
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
    const hasil = await jalankanAntreanDrive();
    return NextResponse.json({ ok: true, ...hasil });
  } catch (err) {
    console.error("[cron/gdrive] gagal:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal" },
      { status: 500 },
    );
  }
}
