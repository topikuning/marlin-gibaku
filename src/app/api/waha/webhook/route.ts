import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getWahaWebhookSecret } from "@/lib/waha/config";
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
export async function POST(req: Request) {
  const expected = await getWahaWebhookSecret();
  if (!expected) {
    // Webhook belum diaktifkan (secret belum diatur di Sistem).
    return NextResponse.json({ error: "Webhook belum diaktifkan" }, { status: 503 });
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get("token") ?? req.headers.get("x-webhook-secret");
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Token tidak valid" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON" }, { status: 400 });
  }

  try {
    const result = await ingestWaEvent(body);
    // Selalu 200 untuk event yang terautentikasi — supaya WAHA tidak retry
    // hanya karena pesan diabaikan (mis. grup tak tertaut). `stored` = penanda.
    return NextResponse.json({ ok: true, stored: result.stored, reason: result.reason });
  } catch (err) {
    console.error("[waha/webhook] gagal ingest:", err);
    return NextResponse.json({ error: "Gagal memproses" }, { status: 500 });
  }
}
