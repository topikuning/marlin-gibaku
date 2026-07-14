/**
 * Instrumentation Next.js — pola resmi: logika node-only dipisah ke
 * instrumentation-node.ts dan di-import di balik guard NEXT_RUNTIME
 * (di-inline saat build → bundle edge membuang cabang ini; tanpa pola ini
 * build gagal karena argon2/fs ikut ke bundle edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
