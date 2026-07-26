import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getWahaWebhookSecret, recordWahaHit } from "@/lib/waha/config";
import { ingestWaEvent } from "@/lib/waha/ingest";

export const dynamic = "force-dynamic";

/** Bandingkan rahasia secara timing-safe (tahan panjang beda). */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Webhook inbound WAHA — WAHA mem-POST event pesan ke sini. Auth: secret via
 * query `?token=` ATAU header `X-Webhook-Secret` (dibandingkan timing-safe
 * dengan `waha.webhook_secret` di Sistem). Hanya pesan dari grup tertaut paket
 * yang disimpan (lihat ingestWaEvent). DECISIONS 119.
 */
/**
 * GET (mis. dibuka di browser) — balas ramah, BUKAN error. Endpoint ini hanya
 * memproses POST dari WAHA; tidak membocorkan apa pun & tidak mengecek token.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "marlin-waha-webhook",
    message: "Endpoint webhook WAHA aktif. Hanya menerima POST dari WAHA (GET ini hanya info).",
  });
}

export async function POST(req: Request) {
  const expected = await getWahaWebhookSecret();
  const url = new URL(req.url);
  const provided = url.searchParams.get("token") ?? req.headers.get("x-webhook-secret");
  const tokenOk = !!expected && secretMatches(provided, expected);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* body bukan JSON — tetap dicatat di log hit */
  }
  const event =
    body && typeof (body as { event?: unknown }).event === "string"
      ? (body as { event: string }).event
      : "(tanpa event)";

  let status = 200;
  let outcome = "";
  let chatId: string | null = null;

  if (!expected) {
    status = 503;
    outcome = "secret webhook belum diatur di Sistem";
  } else if (!tokenOk) {
    status = 401;
    outcome = "token tidak valid (URL webhook di WAHA tidak cocok dengan secret)";
  } else if (body === null) {
    status = 400;
    outcome = "body bukan JSON";
  } else {
    try {
      const result = await ingestWaEvent(body);
      chatId = result.chatId ?? null;
      outcome = result.stored ? "tersimpan ✓" : `diabaikan — ${result.reason}`;
    } catch (err) {
      console.error("[waha/webhook] gagal ingest:", err);
      status = 500;
      outcome = "error saat memproses";
    }
  }

  // Catat SETIAP hit (untuk diagnosa di Sistem). Kegagalan pencatatan tak
  // boleh menggagalkan respons ke WAHA.
  try {
    await recordWahaHit({ tokenOk, event, chatId, outcome });
  } catch (err) {
    console.error("[waha/webhook] gagal catat hit:", err);
  }

  // 200 untuk hit terautentikasi (walau diabaikan) supaya WAHA tak retry; selain
  // itu kembalikan status error yang sesuai.
  return NextResponse.json({ ok: status === 200, outcome }, { status });
}
