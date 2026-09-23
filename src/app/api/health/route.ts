import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + DB. Dipakai healthcheck Railway. R2 sengaja BUKAN dependency di sini. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "up",
      timestamp: new Date().toISOString(),
      /*
       * Sudah berapa lama proses INI hidup (DECISIONS 607).
       *
       * Dipakai browser untuk membedakan dua kegagalan yang kalimatnya sama
       * persis: "server menolak permintaan ini" versus "tab ini lebih tua
       * daripada servernya". ID server action di-hash per build, jadi ia hilang
       * tepat ketika server dimulai ulang dengan build baru — server yang sudah
       * jalan lebih SEBENTAR daripada umur halaman bukan server yang mengirim
       * halaman itu.
       *
       * DURASI, bukan cap waktu: dibandingkan dengan `performance.now()` yang
       * juga durasi, jadi jam browser yang meleset tidak ikut bermain.
       */
      uptimeMs: Math.round(process.uptime() * 1000),
    });
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
