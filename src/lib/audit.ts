import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requestIp } from "@/lib/auth/session";

/**
 * Klien Prisma di dalam `$transaction` — cukup bagian yang dipakai audit,
 * supaya `auditIn` bisa menerima `tx` tanpa mengimpor tipe transaksi Prisma.
 */
type AuditTx = { auditLog: { create: (args: { data: AuditData }) => Promise<unknown> } };

type AuditData = Prisma.AuditLogUncheckedCreateInput;

/** BigInt tidak bisa di-JSON-kan; disimpan sebagai string di payload. */
function auditData(
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null | undefined,
  payload: Record<string, unknown> | undefined,
  ip: string | null,
): AuditData {
  return {
    userId,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    ip,
    payload: payload
      ? (JSON.parse(
          JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ) as Prisma.InputJsonValue)
      : undefined,
  };
}

/**
 * Catat mutasi ke audit log (append-only) — versi BEST-EFFORT.
 * Gagal menulis audit tidak menggagalkan aksi utama, hanya dicatat ke console.
 *
 * JANGAN dipakai untuk mutasi UANG atau STATUS: untuk itu gunakan `auditIn`
 * di dalam transaksi yang sama (AUDIT-01), supaya tidak mungkin ada perubahan
 * yang berhasil tanpa jejaknya.
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
      data: auditData(userId, action, resourceType, resourceId, payload, (await requestIp()) ?? null),
    });
  } catch (err) {
    console.error("[audit] gagal menulis audit log:", action, err);
  }
}

/**
 * Catat mutasi ke audit log DI DALAM transaksi pemanggil (AUDIT-01).
 *
 * Bedanya dengan `audit`: kegagalan TIDAK ditelan — errornya dilempar ulang
 * sehingga `$transaction` ikut batal. Artinya mutasi uang/status dan jejaknya
 * selalu sehidup-semati: tidak ada uang berpindah tanpa audit, dan tidak ada
 * audit atas perubahan yang batal.
 *
 * `ip` dilewatkan dari luar (mis. hasil `requestIp()` sebelum transaksi dibuka)
 * supaya tidak ada pembacaan header di tengah transaksi. Bila tidak diberikan,
 * dibaca di sini.
 */
export async function auditIn(
  tx: AuditTx,
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  payload?: Record<string, unknown>,
  ip?: string | null,
): Promise<void> {
  await tx.auditLog.create({
    data: auditData(userId, action, resourceType, resourceId, payload, ip ?? (await requestIp()) ?? null),
  });
}
