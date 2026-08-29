import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prosesAntrean, ringkasAntreanWa } from "@/lib/waha/antrean";
import { bersihkanKlarifikasiBasi } from "@/lib/waha/klarifikasi";
import { bersihkanKonteksBasi } from "@/lib/waha/konteks-lanjutan";
import { jemputTanyaTertunda } from "@/lib/ai-hub/tanya-tertunda";
import { kurasPengingatGrup } from "@/lib/harian/penjadwal-grup";

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
    /*
     * Pertanyaan Ask MARLIN yang MENGGANTUNG ikut dijemput di sini
     * (DECISIONS 456). Jawaban di latar hidup di proses yang sama, jadi deploy
     * ulang di tengah jalan membuatnya hilang; penanda `pendingSince` yang
     * lewat batas sudah cukup sebagai antreannya. Menumpang route ini karena
     * ia memang dipicu tiap menit — bukan sekali sehari.
     *
     * Kegagalan penjemputan TIDAK boleh menggagalkan antrean WhatsApp: dua
     * pekerjaan yang tidak berhubungan tidak boleh saling menjatuhkan.
     */
    let tanyaTertunda: unknown = null;
    try {
      tanyaTertunda = await jemputTanyaTertunda();
    } catch (err) {
      console.error("[cron/waha] jemput tanya tertunda gagal:", err);
    }
    /*
     * Giliran pengingat harian ke GRUP paket ikut dikuras di sini. Ia menumpang
     * route ini justru karena route ini sering: jeda antar grup satu menit,
     * jadi antreannya memang harus dicicil beberapa putaran — bukan dikerjakan
     * sekaligus oleh putaran harian yang cuma sekali sehari.
     *
     * Sama seperti penjemput di atas, kegagalannya tidak boleh menjatuhkan
     * antrean jawaban WhatsApp.
     */
    let pengingatGrup: unknown = null;
    try {
      pengingatGrup = await kurasPengingatGrup();
    } catch (err) {
      console.error("[cron/waha] kuras pengingat grup gagal:", err);
    }
    /*
     * Lampiran yang belum sempat naik ke R2 disapu di sini.
     *
     * Sampai 2026-08-29 penyapu ini TIDAK PERNAH dipanggil dari mana pun —
     * jaring pengaman yang tidak pernah dipasang. Sekarang ia menumpang putaran
     * lima menitan, karena yang dikejar memang berkas yang umurnya di disk
     * sementara bisa lebih pendek daripada jarak antar deploy.
     */
    let lampiranDiarsipkan: unknown = null;
    try {
      const { arsipkanYangTertinggal } = await import("@/lib/waha/lampiran-tangkap");
      lampiranDiarsipkan = await arsipkanYangTertinggal();
    } catch (err) {
      console.error("[cron/waha] arsip lampiran tertinggal gagal:", err);
    }
    return NextResponse.json({
      ok: true,
      ...hasil,
      sisa,
      klarifikasiDibuang,
      konteksDibuang,
      tanyaTertunda,
      pengingatGrup,
      lampiranDiarsipkan,
    });
  } catch (err) {
    console.error("[cron/waha] gagal:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal" },
      { status: 500 },
    );
  }
}
