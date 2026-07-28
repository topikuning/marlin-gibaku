import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + DB. Dipakai healthcheck Railway. R2 sengaja BUKAN dependency di sini. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[health] database tidak terjangkau:", err);
    return NextResponse.json(
      // Pesan error database TIDAK dikembalikan ke publik — bisa memuat host,
      // nama database, atau kredensial (audit Codex 2026-07-28, SEC-01).
      // Detailnya tetap ada di log server untuk operator.
      { status: "error", db: "down", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
