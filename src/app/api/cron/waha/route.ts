import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prosesAntrean, ringkasAntreanWa } from "@/lib/waha/antrean";
import { bersihkanKlarifikasiBasi } from "@/lib/waha/klarifikasi";
import { bersihkanKonteksBasi } from "@/lib/waha/konteks-lanjutan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Processor antrean jawaban WhatsApp (DECISIONS 372) — JARING PENGAMAN.
 *
 *   curl -X POST https://<host>/api/cron/waha -H "x-cron-secret: $CRON_SECRET"
 *
 * Jalur cepatnya ada di webhook, yang memproses tanpa menunggu. Route ini yang
 * menjamin: kalau proses itu mati di tengah jalan, atau pekerjaan tertunda
 * karena backoff, pekerjaannya tetap `antre` di basis data dan diambil di sini.
 * Disarankan dipicu tiap menit.
 *
 * Aman dipicu berkali-kali dan berbarengan: klaim pekerjaan memakai satu
 * `UPDATE … FOR UPDATE SKIP LOCKED`, jadi dua pemanggilan mengambil baris yang
 * BERBEDA, bukan baris yang sama dua kali.
 *
 * Otentikasi lewat `CRON_SECRET`, dan tanpa secret = 404 (bukan 401) supaya
 * keberadaan endpoint-nya tidak bisa dipetakan dari luar — pola yang sama
 * dengan `/api/cron/harian`.
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
    const hasil = await prosesAntrean(25);
    // Sisa antrean & jumlah gagal ikut dilaporkan: cron yang selalu menjawab
    // "ok" tanpa angka tidak bisa membedakan antrean sehat dari antrean macet.
    const sisa = await ringkasAntreanWa();
    /*
     * Tawaran klarifikasi yang sudah lewat umurnya dibuang di sini
     * (DECISIONS 376). Tidak ada yang membacanya lagi, tapi membiarkannya
     * menumpuk membuat tabel itu tumbuh selamanya untuk data berumur 12 menit.
     */
    const klarifikasiDibuang = await bersihkanKlarifikasiBasi();
    const konteksDibuang = await bersihkanKonteksBasi();
    return NextResponse.json({ ok: true, ...hasil, sisa, klarifikasiDibuang, konteksDibuang });
  } catch (err) {
    console.error("[cron/waha] gagal:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal" },
      { status: 500 },
    );
  }
}
