import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Readiness/diagnostik: DB + status konfigurasi R2 (tanpa round-trip R2 — itu di /sistem). */
export async function GET() {
  let dbUp = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
  }
  return NextResponse.json(
    {
      status: dbUp ? "ready" : "degraded",
      db: dbUp ? "up" : "down",
      r2Configured: env.r2 !== null,
      appEnv: env.APP_ENV,
      timestamp: new Date().toISOString(),
    },
    { status: dbUp ? 200 : 503 },
  );
}
