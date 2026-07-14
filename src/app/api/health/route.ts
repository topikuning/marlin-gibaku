import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + DB. Dipakai healthcheck Railway. R2 sengaja BUKAN dependency di sini. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up", timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", db: "down", message: err instanceof Error ? err.message : "unknown", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
