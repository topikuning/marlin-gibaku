import "server-only";
import { db } from "@/lib/db";

/**
 * Master data jenis kegiatan lapangan (tabel FieldActivityKind). Sumber tunggal
 * untuk dropdown form, label tampilan, dan validasi. Bisa dikelola admin di
 * Sistem. DECISIONS 115.
 */

export type ActivityKind = { key: string; label: string; sortOrder: number; isActive: boolean };

export async function getActivityKinds(opts?: { activeOnly?: boolean }): Promise<ActivityKind[]> {
  return db.fieldActivityKind.findMany({
    where: opts?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, label: true, sortOrder: true, isActive: true },
  });
}

/** Peta key→label (SEMUA jenis, termasuk nonaktif) supaya data lama tetap berlabel. */
export async function getActivityKindLabelMap(): Promise<Map<string, string>> {
  const rows = await db.fieldActivityKind.findMany({ select: { key: true, label: true } });
  return new Map(rows.map((r) => [r.key, r.label]));
}

/** Key jenis yang aktif — untuk validasi input form. */
export async function activeActivityKindKeys(): Promise<Set<string>> {
  const rows = await db.fieldActivityKind.findMany({ where: { isActive: true }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}

/** Label aman: pakai peta, fallback ke key mentah bila jenis sudah dihapus. */
export function activityKindLabel(map: Map<string, string>, key: string): string {
  return map.get(key) ?? key;
}
