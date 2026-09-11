import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { jalankanArsipAsli } from "@/lib/arsip-asli/antrean";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Satu putaran pemindahan BERKAS ASLI foto ke arsip dingin.
 *
 *   curl -X POST https://<host>/api/cron/arsip-asli -H "x-cron-secret: $CRON_SECRET"
 *
 * Memakai `CRON_SECRET` yang SUDAH ADA, bukan rahasia baru. Rancangan awal minta
 * endpoint dengan skema otentikasi sendiri (`Bearer ORIGINAL_ARCHIVE_TRIGGER_SECRET`)
 * plus satu image Docker dan satu service Railway khusus untuk memanggilnya.
 * Dua konvensi otentikasi di satu aplikasi berarti dua tempat yang bisa salah,
 * dan yang kedua tidak menambah keamanan apa pun — ia cuma menambah rahasia yang
 * harus diputar dan dijaga.
 *
 * Tanpa secret dibalas 404, bukan 401 — sama seperti jalur cron lain, supaya
 * keberadaan endpoint ini tidak bisa dipetakan dari luar.
 *
 * Aman dipicu berkali-kali dan bersamaan: tiap langkah di dalamnya boleh
 * diulang (kirim → periksa → catat; buang → catat), jadi putaran yang
 * bertabrakan paling buruk mengerjakan berkas yang sama dua kali dengan hasil
 * yang sama.
 *
 * Jadwal yang disarankan: tiap jam. KAPAN ia berjalan ditentukan jadwal cron —
 * itulah sebabnya tidak ada variabel jendela jam di aplikasi. Kalau uplink
 * rumahnya hanya lega tengah malam, jadwalkan tengah malam.
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
    const hasil = await jalankanArsipAsli();
    // Peringatan diperiksa SESUDAH putaran, memakai keadaan terbaru. Gagalnya
    // tidak boleh menggagalkan putaran yang sudah berhasil.
    const { periksaDanPeringatkan } = await import("@/lib/arsip-asli/peringatan");
    const peringatan = await periksaDanPeringatkan().catch(() => null);
    return NextResponse.json({ ...hasil, peringatan });
  } catch (err) {
    // Pesan galat boleh keluar; rahasia tidak pernah ikut karena `dingin.ts`
    // hanya melempar kode status HTTP, tidak pernah token maupun URL lengkap.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Putaran arsip gagal" },
      { status: 500 },
    );
  }
}
