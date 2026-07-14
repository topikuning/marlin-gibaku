import "server-only";
import { db } from "@/lib/db";
import { requestIp } from "@/lib/auth/session";

/**
 * Catat mutasi ke audit log (append-only). Dipanggil dari setiap server action mutasi.
 * Gagal menulis audit tidak boleh menggagalkan aksi utama — dicatat ke console.
 */
export async function audit(
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId,
        action,
        resourceType,
        resourceId: resourceId ?? null,
        ip: (await requestIp()) ?? null,
        payload: payload ? JSON.parse(JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] gagal menulis audit log:", action, err);
  }
}
